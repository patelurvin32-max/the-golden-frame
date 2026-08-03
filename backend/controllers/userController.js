const mongoose = require('mongoose');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');
const { ROLES } = require('../config/constants');

// GET /api/users
exports.getUsers = asyncHandler(async (req, res) => {
  const filter = {};

  const isValidObjectId = (val) => Boolean(val && val !== 'all' && mongoose.Types.ObjectId.isValid(val));

  if (req.user.role === ROLES.SUPER_ADMIN || req.user.role === ROLES.ADMIN) {
    // Super Admin & Admin can view all users from every branch
    if (req.query.role && req.query.role !== 'all') filter.role = req.query.role;
    if (isValidObjectId(req.query.branch)) filter.branches = req.query.branch;
  } else if (req.user.role === ROLES.BRANCH_MANAGER || req.user.role === ROLES.BRANCH_ADMIN) {
    // Branch Manager & Branch Admin can view only users assigned to their own branch
    // Must NOT see Super Admin, Admin, or Branch Admin
    const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
    if (userBranchIds.length === 0) {
      filter.branches = { $in: [] };
    } else if (isValidObjectId(req.query.branch)) {
      if (userBranchIds.includes(req.query.branch.toString())) {
        filter.branches = req.query.branch;
      } else {
        filter.branches = { $in: [] };
      }
    } else {
      filter.branches = { $in: userBranchIds };
    }

    if (req.query.role) {
      if (req.query.role === ROLES.SUPER_ADMIN || req.query.role === ROLES.ADMIN || req.query.role === ROLES.BRANCH_ADMIN) {
        filter.role = { $in: [] };
      } else {
        filter.role = req.query.role;
      }
    } else {
      filter.role = { $nin: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BRANCH_ADMIN] };
    }
  } else {
    // Staff, Cashier, and other roles can only view their own profile
    filter._id = req.user._id;
  }

  const users = await User.find(filter).populate('branches', 'name code').sort('-createdAt');
  res.status(200).json({ success: true, results: users.length, data: { users } });
});

// GET /api/users/:id
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id).populate('branches', 'name code');
  if (!user) return next(new AppError('User not found.', 404));

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.user.role === ROLES.BRANCH_MANAGER || req.user.role === ROLES.BRANCH_ADMIN) {
      if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN || user.role === ROLES.BRANCH_ADMIN) {
        return next(new AppError('You do not have permission to view staff outside your branch.', 403));
      }
      const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
      const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
      const hasOverlap = targetBranchIds.some((id) => userBranchIds.includes(id));
      if (!hasOverlap) {
        return next(new AppError('You do not have permission to view staff outside your branch.', 403));
      }
    } else {
      if (req.user._id.toString() !== user._id.toString()) {
        return next(new AppError('You do not have permission to view other staff profiles.', 403));
      }
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
    permissions,
    isActive,
  } = req.body;

  let assignedBranches = branches;

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    const userBranchId = req.user.branches?.[0]?._id || req.user.branches?.[0];
    if (!userBranchId) {
      return next(new AppError('You do not have an assigned branch to create staff.', 400));
    }
    if (role === ROLES.SUPER_ADMIN || role === ROLES.ADMIN || role === ROLES.BRANCH_ADMIN) {
      return next(new AppError('You cannot create admin users.', 403));
    }
    assignedBranches = [userBranchId];
  }

  // A Branch Admin must always be assigned to exactly one branch during creation
  if (role === ROLES.BRANCH_ADMIN) {
    if (!assignedBranches || assignedBranches.length !== 1) {
      return next(new AppError('A Branch Admin must always be assigned to exactly one branch during creation.', 400));
    }
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
    permissions: role === ROLES.BRANCH_ADMIN ? (permissions || []) : undefined,
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
    'permissions',
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
    if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN || user.role === ROLES.BRANCH_ADMIN) {
      return next(new AppError('You do not have permission to edit staff outside your branch.', 403));
    }
    const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
    const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
    const hasOverlap = targetBranchIds.some((id) => userBranchIds.includes(id));
    if (!hasOverlap) {
      return next(new AppError('You do not have permission to edit staff outside your branch.', 403));
    }
    if (updateData.role && (updateData.role === ROLES.SUPER_ADMIN || updateData.role === ROLES.ADMIN || updateData.role === ROLES.BRANCH_ADMIN)) {
      return next(new AppError('You cannot assign admin roles.', 403));
    }
    delete updateData.branches;
  }

  if (req.user.role !== ROLES.SUPER_ADMIN) {
    // Only Super Admin can modify permissions
    delete updateData.permissions;
  }

  // Ensure Branch Admin is always assigned to exactly one branch
  const newRole = updateData.role || user.role;
  if (newRole === ROLES.BRANCH_ADMIN) {
    const branchesToCheck = updateData.branches !== undefined ? updateData.branches : user.branches;
    if (!branchesToCheck || branchesToCheck.length !== 1) {
      return next(new AppError('A Branch Admin must always be assigned to exactly one branch.', 400));
    }
  }

  // If the role changes away from Branch Admin, clear permissions
  if (updateData.role && updateData.role !== ROLES.BRANCH_ADMIN) {
    user.permissions = [];
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
    if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN || user.role === ROLES.BRANCH_ADMIN) {
      return next(new AppError('You do not have permission to deactivate staff outside your branch.', 403));
    }
    const userBranchIds = (req.user.branches || []).map((b) => (b._id || b).toString());
    const targetBranchIds = (user.branches || []).map((b) => (b._id || b).toString());
    const hasOverlap = targetBranchIds.some((id) => userBranchIds.includes(id));
    if (!hasOverlap) {
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
