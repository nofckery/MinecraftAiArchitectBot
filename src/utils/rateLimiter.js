/**
 * In-Memory sliding-window rate limiter middleware for Express routes.
 * Protects expensive LLM and backend routes from excessive request floods.
 *
 * @param {Object} [options]
 * @param {number} [options.windowMs=60000] - Window duration in milliseconds (default: 1 min)
 * @param {number} [options.max=120] - Maximum requests allowed per IP per window
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const maxRequests = options.max || 120;
  const enableInTest = Boolean(options.enableInTest);
  const hits = new Map(); // ip -> { count, resetTime }

  // Periodic cleanup of stale IP entries every 2 minutes
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(ip);
      }
    }
  }, 120000);
  cleanupInterval.unref?.();

  return function rateLimitMiddleware(req, res, next) {
    if (process.env.NODE_ENV === 'test' && !enableInTest) {
      return next();
    }

    const ip = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    let record = hits.get(ip);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(ip, record);
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        error: `Rate-Limit erreicht. Bitte warte ${retryAfterSec}s vor weiteren Anfragen.`
      });
    }

    next();
  };
}
