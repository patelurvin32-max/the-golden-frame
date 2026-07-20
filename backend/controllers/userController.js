const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');

// GET /api/users
exports.getUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.role) filter.role = req.query.role;
  
  // Branch filtering logic
  if (req.user.role === ROLES.SUPER_ADMIN || req.user.role === ROLES.ADMIN) {
    if (req.query.branch) {
      filter.branches = req.query.branch;
    }
  } else if (req.user.branches && req.user.branches.length > 0) {
    const branchId = req.user.branches[0]._id || req.user.branches[0];
    filter.branches = { $in: [branchId] };
  } else {
    filter.branches = { $in: [] };
  }

  const users = await User.find(filter).populate('branches', 'name code').sort('-createdAt');
  res.status(200).json({ success: true, results: users.length, data: { users } });
});

// GET /api/users/:id
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).populate('branches', 'name code');
  if (!user) return next(new AppError('User not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchId = (req.user.branches?.[0]?._id || req.user.branches?.[0])?.toString();
    const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
    if (!userBranchId || !targetBranchIds.includes(userBranchId)) {
      return next(new AppError('You do not have permission to view staff outside your branch.', 403));
    }
  }

  res.status(200).json({ success: true, data: { user } });
});

// POST /api/users
exports.createUser = asyncHandler(async (req, res, next) => {
  const {
    name,
    email,
    phone,
    address,
    salary,
    joiningDate,
    employmentStatus,
    notes,
    password,
    role,
    branches,
    isActive,
  } = req.body;

  let assignedBranches = branches;

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchId = req.user.branches?.[0]?._id || req.user.branches?.[0];
    if (!userBranchId) {
      return next(new AppError('You do not have an assigned branch to create staff.', 400));
    }
    assignedBranches = [userBranchId];
  }

  const user = await User.create({
    name,
    email,
    phone,
    address,
    salary,
    joiningDate,
    employmentStatus,
    notes,
    password,
    role,
    branches: assignedBranches,
    isActive,
  });

  await user.populate('branches');

  await logActivity({
    userId: req.user._id,
    action: 'user.create',
    entity: 'User',
    entityId: user._id,
    description: `${req.user.name} created user ${user.name} (${user.role})`,
    ipAddress: req.ip,
  });

  res.status(201).json({ success: true, data: { user: user.toSafeObject() } });
});

// PATCH /api/users/:id
exports.updateUser = asyncHandler(async (req, res, next) => {
  const allowedFields = [
    'name',
    'email',
    'phone',
    'address',
    'salary',
    'joiningDate',
    'employmentStatus',
    'notes',
    'role',
    'branches',
    'isActive',
    'avatar',
  ];

  const updateData = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  const user = await User.findById(req.params.id).populate('branches');
  if (!user) return next(new AppError('User not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchId = (req.user.branches?.[0]?._id || req.user.branches?.[0])?.toString();
    const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
    if (!userBranchId || !targetBranchIds.includes(userBranchId)) {
      return next(new AppError('You do not have permission to edit staff outside your branch.', 403));
    }
    delete updateData.branches;
  }

  Object.assign(user, updateData);
  if (req.body.password) {
    user.password = req.body.password;
  }
  await user.save();

  await logActivity({
    userId: req.user._id,
    action: 'user.update',
    entity: 'User',
    entityId: user._id,
    description: `${req.user.name} updated user ${user.name}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, data: { user: user.toSafeObject() } });
});

// DELETE /api/users/:id (soft delete -> deactivate)
exports.deactivateUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(new AppError('User not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchId = (req.user.branches?.[0]?._id || req.user.branches?.[0])?.toString();
    const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
    if (!userBranchId || !targetBranchIds.includes(userBranchId)) {
      return next(new AppError('You do not have permission to deactivate staff outside your branch.', 403));
    }
  }

  user.isActive = false;
  await user.save();

  await logActivity({
    userId: req.user._id,
    action: 'user.deactivate',
    entity: 'User',
    entityId: user._id,
    description: `${req.user.name} deactivated user ${user.name}`,
    ipAddress: req.ip,
  });

  res.status(200).json({ success: true, message: 'User deactivated.' });
});
