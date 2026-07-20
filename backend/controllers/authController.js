const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../services/activityLogService');

const cookieOptions = (maxAgeMs) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = process.env.CLIENT_URL && !process.env.CLIENT_URL.includes('localhost');
  const sameSiteValue = isProduction && isCrossOrigin ? 'none' : 'lax';

  const options = {
    httpOnly: true,
    secure: isProduction || sameSiteValue === 'none',
    sameSite: sameSiteValue,
    maxAge: maxAgeMs,
    path: '/',
  };

  // Don't set domain in production for cross-origin cookies
  // The browser will handle it correctly with SameSite=None and Secure
  if (!isProduction && process.env.CLIENT_URL && process.env.CLIENT_URL.includes('localhost')) {
    try {
      const clientUrl = new URL(process.env.CLIENT_URL);
      options.domain = clientUrl.hostname;
    } catch (err) {
      console.warn('Could not parse CLIENT_URL for cookie domain:', err.message);
    }
  }

  return options;
};

const issueTokens = async (user, res) => {
  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  const hashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await User.updateOne(
    { _id: user._id },
    {
      $set: { lastLogin: new Date() },
      $push: { refreshTokens: { $each: [hashed], $slice: -5 } },
    }
  );

  res.cookie('accessToken', accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie('refreshToken', refreshToken, cookieOptions(30 * 24 * 60 * 60 * 1000));

  return { accessToken, refreshToken };
};

// POST /api/auth/login
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) return next(new AppError('Email and password are required.', 400));

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+password +refreshTokens');

  if (!user) {
    return next(new AppError('Incorrect email or password', 401));
  }

  const passwordMatch = await user.comparePassword(password);
  if (!passwordMatch) {
    return next(new AppError('Incorrect email or password', 401));
  }

  if (!user.isActive) return next(new AppError('Your account has been deactivated.', 403));

  const { accessToken, refreshToken } = await issueTokens(user, res);
  res.status(200).json({
    success: true,
    data: { user: user.toSafeObject(), accessToken, refreshToken },
  });

  void logActivity({
    userId: user._id,
    action: 'auth.login',
    entity: 'User',
    entityId: user._id,
    description: `${user.name} logged in`,
    ipAddress: req.ip,
  });
});

// POST /api/auth/refresh
exports.refresh = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.refreshToken || req.body.refreshToken;
  if (!token) return next(new AppError('Refresh token missing.', 401));

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    return next(new AppError('Invalid or expired refresh token.', 401));
  }

  const hashed = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findById(decoded.id).select('+refreshTokens');
  if (!user || !user.refreshTokens.includes(hashed)) {
    return next(new AppError('Refresh token not recognized. Please log in again.', 401));
  }

  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: hashed } });
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

  const clearOptions = cookieOptions(0);
  res.clearCookie('accessToken', clearOptions);
  res.clearCookie('refreshToken', clearOptions);

  res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('branches');
  res.status(200).json({ success: true, data: { user: user.toSafeObject() } });
});

// PATCH /api/auth/change-password
exports.changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect.', 401));
  }

  user.password = newPassword;
  user.refreshTokens = [];
  await user.save();

  res.status(200).json({ success: true, message: 'Password updated successfully. Please log in again.' });
});
