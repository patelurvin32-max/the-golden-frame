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
      const firstUrl = process.env.CLIENT_URL.split(',')[0].trim();
      const clientUrl = new URL(firstUrl);
      options.domain = clientUrl.hostname;
    } catch (err) {
      // Ignore domain parsing fallback
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
  const user = await User.findOne({ email: normalizedEmail })
    .select('+password +refreshTokens +failedLoginAttempts +lockedUntil +lastFailedLogin');

  // ── Step 1: Check lockout BEFORE checking password (prevents timing attacks) ──
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil - new Date()) / 60_000);
    return next(
      new AppError(`Account locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`, 429)
    );
  }

  // ── Step 2: Generic message for non-existent user (no enumeration) ──
  if (!user) {
    return next(new AppError('Incorrect email or password', 401));
  }

  // ── Step 3: Check password ──
  const passwordMatch = await user.comparePassword(password);

  if (!passwordMatch) {
    // Increment failed attempts
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    user.lastFailedLogin = new Date();

    // Lock after 10 failed attempts for 15 minutes
    if (user.failedLoginAttempts >= 10) {
      user.lockedUntil = new Date(Date.now() + 15 * 60_000);
      await user.save({ validateBeforeSave: false });

      return next(
        new AppError('Account locked due to too many failed attempts. Try again in 15 minutes.', 429)
      );
    }

    await user.save({ validateBeforeSave: false });
    return next(new AppError('Incorrect email or password', 401));
  }

  // ── Step 4: Check account is active ──
  if (!user.isActive) {
    return next(new AppError('Your account has been deactivated.', 403));
  }

  // ── Step 5: Successful login — reset lockout counters ──
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastFailedLogin = null;
    await user.save({ validateBeforeSave: false });
  }

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
