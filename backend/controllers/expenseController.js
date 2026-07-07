const { Expense } = require('../models/Operations');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

exports.getExpenses = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role !== ROLES.SUPER_ADMIN) filter.branch = { $in: req.user.branches };
  if (req.query.branch) filter.branch = req.query.branch;
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
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  const expense = await Expense.create({ ...req.body, branch: finalBranch, createdBy: req.user._id });
  res.status(201).json({ success: true, data: { expense } });
});

exports.updateExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!expense) return next(new AppError('Expense not found.', 404));
  res.status(200).json({ success: true, data: { expense } });
});

exports.deleteExpense = asyncHandler(async (req, res, next) => {
  const expense = await Expense.findByIdAndDelete(req.params.id);
  if (!expense) return next(new AppError('Expense not found.', 404));
  res.status(204).json({ success: true, data: null });
});
