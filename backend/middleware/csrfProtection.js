const { doubleCsrf } = require('csrf-csrf');

if (!process.env.CSRF_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CSRF_SECRET environment variable is required in production');
  }
}

const { doubleCsrfProtection, generateCsrfToken: generateTokenFn } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || 'dev-csrf-secret-not-for-production',
  getSessionIdentifier: (req) => req.user?._id?.toString() || req.cookies?.accessToken || 'anon',
  cookieName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  skipCsrfProtection: (req) =>
    req.path.endsWith('/auth/login') ||
    req.path.endsWith('/auth/refresh') ||
    Boolean(req.headers.authorization?.startsWith('Bearer ')),
});

// Middleware to generate + attach CSRF token to every response
const generateCsrfToken = (req, res, next) => {
  try {
    const token = generateTokenFn(req, res);
    res.set('X-CSRF-Token', token);
  } catch (err) {
    // Non-fatal — token generation fails silently in edge cases
    console.warn('CSRF token generation failed:', err.message);
  }
  next();
};

module.exports = { doubleCsrfProtection, generateCsrfToken };
