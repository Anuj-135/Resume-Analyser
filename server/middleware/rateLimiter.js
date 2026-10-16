const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Factory to create a rate-limiting middleware instance with defensive defaults.
 *
 * @param {object} [options={}] - Overrides for express-rate-limit options
 * @returns {import('express').RequestHandler}
 */
const createRateLimiter = (options = {}) => {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    statusCode: 429,
    ...options,
  });
};

/**
 * Rate limiter for POST /api/auth/login:
 * - 10 requests per 15 minutes per client IP
 * - Standard RateLimit-* headers, no legacy X-RateLimit-*
 * - Returns 429 with consistent JSON message
 */
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { message: 'Too many authentication attempts. Please try again later.' },
  ipv6Subnet: 56,
});

/**
 * Rate limiter for POST /api/auth/register:
 * - 10 requests per 15 minutes per client IP
 * - Independent bucket from login attempts
 * - Returns 429 with consistent JSON message
 */
const registerLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { message: 'Too many authentication attempts. Please try again later.' },
  ipv6Subnet: 56,
});

/**
 * Rate limiter for POST /api/resumes/:id/analyze:
 * - Maximum 5 requests per authenticated user per hour
 * - Keyed by req.userId (with defensive ipKeyGenerator(req.ip) fallback)
 * - Returns 429 with consistent JSON message
 * - Downstream failures do not refund quota (every request reaching limiter counts)
 * - All express-rate-limit built-in validations remain enabled
 */
const analysisLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: { message: 'Too many resume analysis requests. Please try again later.' },
  keyGenerator: (req) => {
    return req.userId ? req.userId.toString() : ipKeyGenerator(req.ip);
  },
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  analysisLimiter,
};
