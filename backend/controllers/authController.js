const crypto = require('crypto');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');

const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: maxAgeMs,
});

const issueTokens = async (user, res) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  // Store a hash of the refresh token (rotation-friendly, revocable)
  const hashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  user.refreshTokens = [...(user.refreshTokens || []), hashed].slice(-5); // keep last 5 sessions
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  res.cookie('accessToken', accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie('refreshToken', refreshToken, cookieOptions(30 * 24 * 60 * 60 * 1000));

  return { accessToken, refreshToken };
};

// POST /api/auth/login
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) return next(new AppError('Email and password are required.', 400));

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password +refreshTokens');
  if (!user || !(await user.comparePassword(password))) {
    return next(new AppError('Incorrect email or password.', 401));
  }
  if (!user.isActive) return next(new AppError('Your account has been deactivated.', 403));

  const { accessToken, refreshToken } = await issueTokens(user, res);

  await logActivity({
    userId: user._id,
    action: 'auth.login',
    entity: 'User',
    entityId: user._id,
    description: `${user.name} logged in`,
    ipAddress: req.ip,
  });

  res.status(200).json({
    success: true,
    data: { user: user.toSafeObject(), accessToken, refreshToken },
  });
});

// POST /api/auth/refresh
exports.refresh = asyncHandler(async (req, res, next) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  if (!token) return next(new AppError('Refresh token missing.', 401));

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (err) {
    return next(new AppError('Invalid or expired refresh token.', 401));
  }

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findById(decoded.id).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(hashed)) {
    return next(new AppError('Refresh token not recognized. Please log in again.', 401));
  }

  // Rotate: remove old, issue new
  user.refreshTokens = user.refreshTokens.filter((t) => t !== hashed);
  const { accessToken, refreshToken } = await issueTokens(user, res);

  res.status(200).json({ success: true, data: { accessToken, refreshToken } });
});

// POST /api/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token && req.user) {
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    req.user.refreshTokens = (req.user.refreshTokens || []).filter((t) => t !== hashed);
    await req.user.save({ validateBeforeSave: false });
  }
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: { user: req.user.toSafeObject() } });
});

// PATCH /api/auth/change-password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect.', 401));
  }

  user.password = newPassword;
  user.refreshTokens = []; // force re-login on all devices
  await user.save();

  res.status(200).json({ success: true, message: 'Password updated successfully. Please log in again.' });
});
