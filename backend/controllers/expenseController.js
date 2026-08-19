const { Expense } = require('../models/Operations');
const PaymentHistory = require('../models/PaymentHistory');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const { createBranchNotification } = require('../services/notificationService');

exports.getExpenseStats = asyncHandler(async (req, res) => {
  const filter = {};
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

  // Get counts and amounts
  const getStats = async (dateFilter) => {
    const match = { ...filter };
    if (dateFilter) match.date = dateFilter;
    const result = await Expense.aggregate([
      { $match: match },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } }
    ]);
    return result.length > 0 ? result[0] : { count: 0, amount: 0 };
  };

  const [today, week, month, total] = await Promise.all([
    getStats({ $gte: todayStart }),
    getStats({ $gte: weekStart }),
    getStats({ $gte: monthStart }),
    getStats(null),
  ]);

  res.status(200).json({
    success: true,
    data: {
      today: today.count,
      todayAmount: today.amount,
      week: week.count,
      weekAmount: week.amount,
      month: month.count,
      monthAmount: month.amount,
      total: total.count,
      totalAmount: total.amount,
    },
  });
});

exports.getExpenses = asyncHandler(async (req, res) => {
  const filter = {};
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
  if (req.query.category) filter.category = req.query.category;
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = new Date(req.query.from);
    if (req.query.to) filter.date.$lte = new Date(req.query.to);
  }

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 25;
  const [expenses, total] = await Promise.all([
    Expense.find(filter)
      .populate('createdBy', 'name')
      .populate('branch', 'name')
      .sort('-date')
      .skip((page - 1) * limit)
      .limit(limit),
    Expense.countDocuments(filter),
  ]);

  res.status(200).json({ success: true, results: expenses.length, total, data: { expenses } });
});

exports.createExpense = asyncHandler(async (req, res, next) => {
  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = req.body.branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!finalBranch || !userBranchIds.includes(finalBranch.toString())) {
      return next(new AppError('You do not have access to this branch.', 403));
    }
  }

  const { paymentStatus, paymentMethod, cashAmount, onlineAmount, walletAmount, totalPaid, pendingAmount } = req.body;

  const expense = await Expense.create({ ...req.body, branch: finalBranch, createdBy: req.user._id });

  if (paymentStatus || paymentMethod) {
    await PaymentHistory.create({
      expense: expense._id,
      branch: finalBranch,
      paymentMethod: paymentMethod || null,
      cashAmount: cashAmount || 0,
      onlineAmount: onlineAmount || 0,
      walletAmount: walletAmount || 0,
      totalPaid: totalPaid || 0,
      billAmount: expense.amount,
      pendingAmount: pendingAmount || 0,
      paymentStatus: paymentStatus || 'paid',
      notes: req.body.notes || '',
      createdBy: req.user._id,
      paymentNumber: 1,
    });
  }

  createBranchNotification({
    branchId: finalBranch,
    actor: req.user,
    title: 'New Expense Added',
    message: `${req.user.name} recorded a new expense (${expense.title || expense.category || 'Expense'}) of ₹${expense.amount || 0}.`,
    req,
  }).catch((err) => console.error('Error creating expense notification:', err));

  res.status(201).json({ success: true, data: { expense } });
});

exports.updateExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('Expense not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(expense.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
    if (req.body.branch && !userBranchIds.includes(req.body.branch.toString())) {
      return next(new AppError('You cannot assign to this branch.', 403));
    }
  }

  const updatedExpense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!updatedExpense) return next(new AppError('Expense not found.', 404));

  const { paymentStatus, paymentMethod, cashAmount, onlineAmount, walletAmount, totalPaid, pendingAmount } = req.body;

  if (paymentStatus || paymentMethod) {
    let paymentHistory = await PaymentHistory.findOne({ expense: updatedExpense._id });
    if (paymentHistory) {
      paymentHistory.paymentMethod = paymentMethod || null;
      paymentHistory.cashAmount = cashAmount || 0;
      paymentHistory.onlineAmount = onlineAmount || 0;
      paymentHistory.walletAmount = walletAmount || 0;
      paymentHistory.totalPaid = totalPaid || 0;
      paymentHistory.billAmount = updatedExpense.amount;
      paymentHistory.pendingAmount = pendingAmount || 0;
      paymentHistory.paymentStatus = paymentStatus || 'paid';
      paymentHistory.notes = req.body.notes || '';
      await paymentHistory.save();
    } else {
      await PaymentHistory.create({
        expense: updatedExpense._id,
        branch: updatedExpense.branch,
        paymentMethod: paymentMethod || null,
        cashAmount: cashAmount || 0,
        onlineAmount: onlineAmount || 0,
        walletAmount: walletAmount || 0,
        totalPaid: totalPaid || 0,
        billAmount: updatedExpense.amount,
        pendingAmount: pendingAmount || 0,
        paymentStatus: paymentStatus || 'paid',
        notes: req.body.notes || '',
        createdBy: req.user._id,
        paymentNumber: 1,
      });
    }
  }

  createBranchNotification({
    branchId: updatedExpense.branch,
    actor: req.user,
    title: 'Expense Updated',
    message: `${req.user.name} updated expense (${updatedExpense.title || updatedExpense.category || 'Expense'}).`,
    req,
  }).catch((err) => console.error('Error creating expense notification:', err));

  res.status(200).json({ success: true, data: { expense: updatedExpense } });
});

exports.deleteExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findById(req.params.id);
  if (!expense) return next(new AppError('Expense not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
    if (!userBranchIds.includes(expense.branch?.toString())) {
      return next(new AppError('You do not have access to this branch\'s data.', 403));
    }
  }

  await expense.deleteOne();
  res.status(204).json({ success: true, data: null });
});
