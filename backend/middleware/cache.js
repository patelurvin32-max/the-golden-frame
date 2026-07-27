/**
 * Simple in-memory response cache middleware.
 * No external dependencies — uses a plain Map with TTL-based expiry.
 *
 * Usage:
 *   router.get('/branches', protect, cacheMiddleware(300), branchController.getBranches);
 *
 * Cache is keyed by `${req.originalUrl}--${req.user?.id}` so each user
 * gets their own cache entry (important for branch-scoped responses).
 */
const cache = new Map();

/**
 * @param {number} ttlSeconds - How long to cache the response (default 60s)
 */
const cacheMiddleware = (ttlSeconds = 60) => (req, res, next) => {
  // Only cache GET requests
  if (req.method !== 'GET') return next();

  const key = `${req.originalUrl}--${req.user?.id || 'anon'}`;
  const cached = cache.get(key);

  if (cached && Date.now() < cached.expiresAt) {
    return res.status(200).json(cached.data);
  }

  // Override res.json to intercept and cache the response
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    if (res.statusCode === 200) {
      cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
    return originalJson(data);
  };

  next();
};

/**
 * Clear cache entries whose key contains the given pattern string.
 * Call this after mutations (create/update/delete) to bust stale cache.
 *
 * @param {string} pattern - Substring to match against cache keys
 */
const clearCache = (pattern) => {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
};

module.exports = { cacheMiddleware, clearCache };
