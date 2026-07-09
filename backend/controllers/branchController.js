const Branch = require('../models/Branch');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');

// GET /api/branches  (all roles - scoped automatically for managers/staff via query)
exports.getBranches = asyncHandler(async (req, res) => {
  const { ROLES } = require('../config/constants');
  let filter = {};
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter = { _id: { $in: req.user.branches } };
  }
  const branches = await Branch.find(filter).sort('name');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.status(200).json({ success: true, results: branches.length, data: { branches } });
});

// GET /api/branches/:id
exports.getBranch = asyncHandler(async (req, res, next) => {
  const branch = await Branch.findById(req.params.id);
  if (!branch) return next(new AppError('Branch not found.', 404));
  res.status(200).json({ success: true, data: { branch } });
});

// POST /api/branches (super admin only)
exports.createBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.create({ ...req.body, createdBy: req.user._id });

  await logActivity({
    userId: req.user._id,
    action: 'branch.create',
    entity: 'Branch',
    entityId: branch._id,
    description: `${req.user.name} created branch ${branch.name}`,
    ipAddress: req.ip,
  });

  res.status(201).json({ success: true, data: { branch } });
});

// PATCH /api/branches/:id (super admin only)
exports.updateBranch = asyncHandler(async (req, res, next) => {
  const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!branch) return next(new AppError('Branch not found.', 404));
  res.status(200).json({ success: true, data: { branch } });
});

// DELETE /api/branches/:id (super admin only - soft delete)
exports.deleteBranch = asyncHandler(async (req, res, next) => {
  const branch = await Branch.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!branch) return next(new AppError('Branch not found.', 404));

  await logActivity({
    userId: req.user._id,
    action: 'branch.deactivate',
    entity: 'Branch',
    entityId: branch._id,
    description: `${req.user.name} deactivated branch ${branch.name}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, message: 'Branch deactivated.' });
});
