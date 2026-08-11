const Wallet = require('../models/Wallet');
const WalletCounter = require('../models/WalletCounter');
const PaymentHistory = require('../models/PaymentHistory');
const Customer = require('../models/Customer');
const WalletTransaction = require('../models/WalletTransaction');
const { generateCustomerId } = require('./customerController');
const { Settings } = require('../models/System');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');
const { generateInvoicePDF } = require('../services/pdfService');
const mongoose = require('mongoose');

// Helper to extract clean branch ObjectId string regardless of populated objects
const getBranchIdString = (b) => {
  if (!b) return '';
  if (typeof b === 'string') return b;
  if (typeof b === 'object' && b._id) return b._id.toString();
  return b.toString();
};

// Helper function to generate Wallet ID with format: YYYY/MM/DD/W0001 (branch-wise)
const generateWalletId = async (branchId, date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}/${month}/${day}`;
  
  // Branch-specific counter key to ensure independent sequences per branch
  const counterKey = `wallet_${branchId}_${dateStr}`;
  
  let attempts = 0;
  while (attempts < 50) {
    attempts++;
    const counter = await WalletCounter.findByIdAndUpdate(
      counterKey,
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    const sequence = String(counter.seq).padStart(4, '0');
    const walletId = `${dateStr}/W${sequence}`;

    // Check if this wallet ID already exists for this branch
    const exists = await Wallet.findOne({ walletId, branch: branchId });
    if (!exists) {
      return walletId;
    }
  }

  return `${dateStr}/W${Date.now()}`;
};

exports.generateWalletId = generateWalletId;

// GET /api/wallet-management/stats
exports.getWalletStats = asyncHandler(async (req, res) => {
  const filter = {};
  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);
  
  // Branch filtering: Super Admin can see all, Branch Admin only their branch
  if (req.user.role === ROLES.BRANCH_ADMIN) {
    filter.branch = { $in: userBranchIds.map(id => new mongoose.Types.ObjectId(id)) };
  } else if (req.user.role === ROLES.SUPER_ADMIN && req.query.branch) {
    filter.branch = new mongoose.Types.ObjectId(req.query.branch);
  }

  // Get date ranges
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Get counts and totals using a single aggregation for much faster load times
  const statsResult = await Wallet.aggregate([
    { $match: filter },
    {
      $facet: {
        totalCount: [{ $count: 'count' }],
        todayCount: [{ $match: { createdAt: { $gte: todayStart } } }, { $count: 'count' }],
        weekCount: [{ $match: { createdAt: { $gte: weekStart } } }, { $count: 'count' }],
        monthCount: [{ $match: { createdAt: { $gte: monthStart } } }, { $count: 'count' }],
        todayTotal: [
          { $match: { createdAt: { $gte: todayStart } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ],
        monthTotal: [
          { $match: { createdAt: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]
      }
    }
  ]);

  const stats = statsResult[0] || {};
  
  res.status(200).json({
    success: true,
    data: {
      today: stats.todayCount?.[0]?.count || 0,
      week: stats.weekCount?.[0]?.count || 0,
      month: stats.monthCount?.[0]?.count || 0,
      total: stats.totalCount?.[0]?.count || 0,
      todayAmount: stats.todayTotal?.[0]?.total || 0,
      monthAmount: stats.monthTotal?.[0]?.total || 0,
    },
  });
});

// GET /api/wallet-management?search=&branch=&page=&limit=&sortBy=&sortOrder=
exports.getWallets = asyncHandler(async (req, res) => {
  const filter = {};
  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);
  
  // Branch filtering: Super Admin can see all, Branch Admin only their branch
  if (req.user.role === ROLES.BRANCH_ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.user.role === ROLES.SUPER_ADMIN && req.query.branch) {
    filter.branch = req.query.branch;
  }
  
  // Server-side search by name, mobile number, or wallet ID
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { name: searchRegex },
      { mobileNumber: searchRegex },
      { walletId: searchRegex },
    ];
  }

  // Filter by payment status
  if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
  
  // Filter by payment method
  if (req.query.paymentMethod) filter.paymentMethod = req.query.paymentMethod;

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  // Sorting
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const sort = { [sortBy]: sortOrder };

  const [wallets, total] = await Promise.all([
    Wallet.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name')
      .populate('branch', 'name')
      .lean(),
    Wallet.countDocuments(filter),
  ]);

  // Populate actual remaining customer balance from Customer collection
  const customerPhones = Array.from(new Set(wallets.map(w => w.mobileNumber).filter(Boolean)));
  const customers = await Customer.find({ phone: { $in: customerPhones } }).select('phone walletBalance').lean();
  const customerBalanceMap = new Map();
  customers.forEach(c => {
    if (c.phone) customerBalanceMap.set(c.phone.trim(), c.walletBalance !== undefined ? c.walletBalance : 0);
  });

  const enrichedWallets = wallets.map(w => {
    const phone = (w.mobileNumber || '').trim();
    const remainingBalance = customerBalanceMap.has(phone) ? customerBalanceMap.get(phone) : w.amount;
    return {
      ...w,
      remainingBalance,
    };
  });

  res.status(200).json({ 
    success: true, 
    results: enrichedWallets.length, 
    total, 
    page,
    pages: Math.ceil(total / limit),
    limit,
    data: { wallets: enrichedWallets } 
  });
});

// POST /api/wallet-management
exports.createWallet = asyncHandler(async (req, res, next) => {
  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);

  let finalBranch = getBranchIdString(req.body.branch);
  if (req.user.role === ROLES.BRANCH_ADMIN) {
    if (!finalBranch || !userBranchIds.includes(finalBranch)) {
      finalBranch = userBranchIds[0];
    }
    if (!finalBranch || !userBranchIds.includes(finalBranch)) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  // Validate mobile number (10 digits, numeric only)
  const mobileNumber = req.body.mobileNumber;
  if (!mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
    return next(new AppError('Mobile number must be exactly 10 digits.', 400));
  }

  // Generate wallet ID with branch-specific sequence
  const walletId = await generateWalletId(finalBranch);

  const { paymentStatus, paymentMethod, cashAmount, onlineAmount, walletAmount, totalPaid, pendingAmount } = req.body;

  const wallet = await Wallet.create({ 
    ...req.body, 
    walletId,
    branch: finalBranch, 
    createdBy: req.user._id 
  });

  // Create payment history record if payment details provided
  if (paymentStatus || paymentMethod) {
    await PaymentHistory.create({
      wallet: wallet._id,
      branch: finalBranch,
      paymentMethod: paymentMethod || null,
      cashAmount: cashAmount || 0,
      onlineAmount: onlineAmount || 0,
      walletAmount: walletAmount || 0,
      totalPaid: totalPaid || 0,
      billAmount: wallet.amount,
      pendingAmount: pendingAmount || 0,
      paymentStatus: paymentStatus || 'paid',
      notes: req.body.notes || '',
      createdBy: req.user._id,
      paymentNumber: 1,
    });
  }

  // Sync Customer wallet balance and transactions
  try {
    let customer = await Customer.findOne({ phone: wallet.mobileNumber, branch: finalBranch });
    if (!customer) {
      customer = await Customer.findOne({ phone: wallet.mobileNumber });
    }

    if (customer) {
      customer.walletBalance = (customer.walletBalance || 0) + wallet.amount;
      customer.walletTransactions.push({
        type: 'credit',
        amount: wallet.amount,
        balance: customer.walletBalance,
        description: `Wallet Top-Up (${wallet.walletId})`,
        createdBy: req.user._id,
        createdAt: wallet.createdAt,
      });
      await customer.save();
    } else {
      const custId = await generateCustomerId(finalBranch);
      await Customer.create({
        customerId: custId,
        name: wallet.name,
        phone: wallet.mobileNumber,
        email: wallet.email || '',
        branch: finalBranch,
        walletBalance: wallet.amount,
        walletTransactions: [{
          type: 'credit',
          amount: wallet.amount,
          balance: wallet.amount,
          description: `Wallet Top-Up (${wallet.walletId})`,
          createdBy: req.user._id,
          createdAt: wallet.createdAt,
        }],
        sourceModule: 'Billing',
      });
    }
  } catch (err) {
    console.error('Error syncing customer wallet balance on create:', err);
  }

  createBranchNotification({
    branchId: finalBranch,
    actor: req.user,
    title: 'New Wallet Added',
    message: `${req.user.name} added a new wallet (${wallet.walletId}) for ${wallet.name} with amount ₹${wallet.amount}.`,
    req,
  }).catch((err) => console.error('Error creating wallet notification:', err));

  res.status(201).json({ success: true, data: { wallet } });
});

// PATCH /api/wallet-management/:id
exports.updateWallet = asyncHandler(async (req, res, next) => {
  const wallet = await Wallet.findById(req.params.id);
  if (!wallet) return next(new AppError('Wallet not found.', 404));

  const oldAmount = wallet.amount || 0;
  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);
  const walletBranchId = getBranchIdString(wallet.branch);

  // Branch access validation
  if (req.user.role === ROLES.BRANCH_ADMIN) {
    if (!userBranchIds.includes(walletBranchId)) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
    // Prevent Branch Admin from changing the branch
    if (req.body.branch) {
      delete req.body.branch;
    }
  } else if (req.user.role === ROLES.SUPER_ADMIN && req.body.branch) {
    // Super Admin can change branch, but validate it's a valid branch
    // (Optional: Add branch existence validation here if needed)
  }

  // Validate mobile number if provided
  if (req.body.mobileNumber && !/^\d{10}$/.test(req.body.mobileNumber)) {
    return next(new AppError('Mobile number must be exactly 10 digits.', 400));
  }

  const updatedWallet = await Wallet.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updatedWallet) return next(new AppError('Wallet not found.', 404));

  const diffAmount = (updatedWallet.amount || 0) - oldAmount;
  if (diffAmount !== 0) {
    try {
      let customer = await Customer.findOne({ phone: updatedWallet.mobileNumber, branch: updatedWallet.branch });
      if (!customer) {
        customer = await Customer.findOne({ phone: updatedWallet.mobileNumber });
      }
      if (customer) {
        customer.walletBalance = Math.max(0, (customer.walletBalance || 0) + diffAmount);
        customer.walletTransactions.push({
          type: diffAmount > 0 ? 'credit' : 'debit',
          amount: Math.abs(diffAmount),
          balance: customer.walletBalance,
          description: `Wallet Adjustment (${updatedWallet.walletId})`,
          createdBy: req.user._id,
        });
        await customer.save();
      }
    } catch (err) {
      console.error('Error syncing customer wallet balance on update:', err);
    }
  }

  const { paymentStatus, paymentMethod, cashAmount, onlineAmount, walletAmount, totalPaid, pendingAmount } = req.body;

  // Update payment history if payment details provided
  if (paymentStatus || paymentMethod) {
    let paymentHistory = await PaymentHistory.findOne({ wallet: updatedWallet._id });
    if (paymentHistory) {
      paymentHistory.paymentMethod = paymentMethod || null;
      paymentHistory.cashAmount = cashAmount || 0;
      paymentHistory.onlineAmount = onlineAmount || 0;
      paymentHistory.walletAmount = walletAmount || 0;
      paymentHistory.totalPaid = totalPaid || 0;
      paymentHistory.billAmount = updatedWallet.amount;
      paymentHistory.pendingAmount = pendingAmount || 0;
      paymentHistory.paymentStatus = paymentStatus || 'paid';
      paymentHistory.notes = req.body.notes || '';
      await paymentHistory.save();
    } else {
      await PaymentHistory.create({
        wallet: updatedWallet._id,
        branch: updatedWallet.branch,
        paymentMethod: paymentMethod || null,
        cashAmount: cashAmount || 0,
        onlineAmount: onlineAmount || 0,
        walletAmount: walletAmount || 0,
        totalPaid: totalPaid || 0,
        billAmount: updatedWallet.amount,
        pendingAmount: pendingAmount || 0,
        paymentStatus: paymentStatus || 'paid',
        notes: req.body.notes || '',
        createdBy: req.user._id,
        paymentNumber: 1,
      });
    }
  }

  createBranchNotification({
    branchId: updatedWallet.branch,
    actor: req.user,
    title: 'Wallet Updated',
    message: `${req.user.name} updated wallet (${updatedWallet.walletId}) for ${updatedWallet.name}.`,
    req,
  }).catch((err) => console.error('Error creating wallet notification:', err));

  res.status(200).json({ success: true, data: { wallet: updatedWallet } });
});

// DELETE /api/wallet-management/:id
exports.deleteWallet = asyncHandler(async (req, res, next) => {
  const wallet = await Wallet.findById(req.params.id);
  if (!wallet) return next(new AppError('Wallet not found.', 404));

  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);
  const walletBranchId = getBranchIdString(wallet.branch);

  // Branch access validation
  if (req.user.role === ROLES.BRANCH_ADMIN) {
    if (!userBranchIds.includes(walletBranchId)) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  // Sync Customer wallet balance on delete
  try {
    let customer = await Customer.findOne({ phone: wallet.mobileNumber, branch: wallet.branch });
    if (!customer) {
      customer = await Customer.findOne({ phone: wallet.mobileNumber });
    }
    if (customer) {
      customer.walletBalance = Math.max(0, (customer.walletBalance || 0) - wallet.amount);
      customer.walletTransactions.push({
        type: 'debit',
        amount: wallet.amount,
        balance: customer.walletBalance,
        description: `Wallet Deleted (${wallet.walletId})`,
        createdBy: req.user._id,
      });
      await customer.save();
    }
  } catch (err) {
    console.error('Error syncing customer wallet balance on delete:', err);
  }

  await wallet.deleteOne();
  res.status(204).json({ success: true, data: null });
});

// GET /api/wallet-management/:id/pdf — stream PDF invoice using standard pdfService and Settings
exports.downloadWalletPDF = asyncHandler(async (req, res, next) => {
  const wallet = await Wallet.findById(req.params.id)
    .populate('branch', 'name address phone')
    .populate('createdBy', 'name')
    .lean();

  if (!wallet) return next(new AppError('Wallet not found.', 404));

  const userBranchIds = (req.user.branches || []).map(getBranchIdString).filter(Boolean);
  const walletBranchId = getBranchIdString(wallet.branch);

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (!userBranchIds.includes(walletBranchId)) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  const branchId = wallet.branch?._id || wallet.branch;
  const [branchSettings, globalSettings] = await Promise.all([
    Settings.findOne({ branch: branchId }).lean(),
    Settings.findOne({ branch: { $exists: false } }).lean(),
  ]);
  const settings = branchSettings || globalSettings || await Settings.findOne().lean();

  const rawPaid = wallet.paidAmount || wallet.amount;
  const discPct = wallet.discountPercent || 0;
  const discAmt = wallet.discountAmount || 0;

  // Build items array using existing invoice structure
  const items = [
    {
      name: 'Wallet Top-Up / Credit',
      quantity: 1,
      unitPrice: rawPaid,
      total: rawPaid,
      type: 'wallet',
    },
  ];

  if (discPct > 0 && discAmt > 0) {
    items.push({
      name: `Discount Bonus (${discPct}%)`,
      quantity: 1,
      unitPrice: discAmt,
      total: discAmt,
      type: 'discount',
    });
  }

  // Construct bill object compatible with generateInvoicePDF in pdfService.js
  const walletBill = {
    _id: wallet._id,
    invoiceNumber: wallet.walletId,
    customerName: wallet.name,
    customerPhone: wallet.mobileNumber,
    customer: {
      name: wallet.name,
      phone: wallet.mobileNumber,
      email: wallet.email || '',
    },
    branch: wallet.branch,
    createdBy: wallet.createdBy,
    createdAt: wallet.createdAt,
    items,
    subtotal: rawPaid,
    discountTotal: 0,
    taxTotal: 0,
    total: wallet.amount, // Total wallet balance credited
    paymentStatus: wallet.paymentStatus || 'paid',
    paymentMethod: wallet.paymentMethod || 'cash',
    cashAmount: wallet.cashAmount || 0,
    onlineAmount: wallet.onlineAmount || 0,
    walletAmount: 0,
    totalPaid: wallet.totalPaid || rawPaid,
    pendingAmount: wallet.pendingAmount || 0,
    notes: wallet.notes || '',
  };

  const pdfBuffer = await generateInvoicePDF(walletBill, settings || {});
  const safeFilename = (wallet.walletId || 'wallet_invoice').replace(/[/\\?%*:|"<>]/g, '_');

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeFilename}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });
  res.end(pdfBuffer);
});
