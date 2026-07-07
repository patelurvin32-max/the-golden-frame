const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLES, PERMISSIONS } = require('../config/constants');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Verifies the access token (from Authorization header or cookie) and attaches
 * the authenticated user to req.user. Also checks the user hasn't changed their
 * password since the token was issued (invalidates old tokens).
 */
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return next(new AppError('You are not logged in. Please log in to continue.', 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    return next(new AppError('Invalid or expired session. Please log in again.', 401));
  }

  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) {
    return next(new AppError('User no longer exists or is deactivated.', 401));
  }

  if (user.changedPasswordAfter(decoded.iat)) {
    return next(new AppError('Password was changed recently. Please log in again.', 401));
  }

  req.user = user;
  next();
});

/**
 * Restricts access to the listed roles. Super admin is NOT auto-bypassed here
 * because some endpoints (rare) may be manager/staff-only by design; use this
 * intentionally alongside requirePermission for the common case.
 */
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }
  next();
};

/**
 * Permission-based guard. Super admin always passes. Manager/staff are checked
 * against the PERMISSIONS map in config/constants.js.
 */
const requirePermission = (permission) => (req, res, next) => {
  if (req.user.role === ROLES.SUPER_ADMIN) return next();

  const allowed = PERMISSIONS[req.user.role] || [];
  if (!allowed.includes(permission)) {
    return next(new AppError('You do not have permission to perform this action.', 403));
  }
  next();
};

/**
 * Ensures branch-scoped roles (manager/staff) only operate on branches they're
 * assigned to. Expects req.params.branchId or req.body.branch to identify the
 * target branch. Super admin bypasses this check entirely.
 */
const scopeToBranch = (req, res, next) => {
  if (req.user.role === ROLES.SUPER_ADMIN) return next();

  const targetBranch = req.params.branchId || req.body.branch || req.query.branch;
  if (!targetBranch) return next(); // some routes are branch-list endpoints; filtered downstream

  const allowedBranchIds = (req.user.branches || []).map((b) => b.toString());
  if (!allowedBranchIds.includes(targetBranch.toString())) {
    return next(new AppError('You do not have access to this branch.', 403));
  }
  next();
};

module.exports = { protect, restrictTo, requirePermission, scopeToBranch };
