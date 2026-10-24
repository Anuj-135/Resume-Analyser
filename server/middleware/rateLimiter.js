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

/**
 * Global rate limiter for POST /api/resumes/:id/analyze:
 * - 50 requests per hour across all users for this Node.js process instance.
 * - Keyed by a constant identifier ('global_ai_analysis_bucket').
 * - Note: This limit is per process instance (in-memory store), resets on
 *   process restart, and acts as an instance-level request throughput cap rather
 *   than a guaranteed Gemini-call count or monetary spend ceiling.
 * - Validation disables keyGeneratorIpFallback check for this intentional constant key.
 */
const globalAnalysisLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 50,
  message: { message: 'System-wide AI analysis capacity reached. Please try again later.' },
  keyGenerator: () => 'global_ai_analysis_bucket',
  validate: { keyGeneratorIpFallback: false },
});

/**
 * IP rate limiter for POST /api/resumes (Upload):
 * - 25 requests per 15 minutes per client IP.
 * - Evaluated before Multer file-buffer allocation to mitigate DoS and memory exhaustion.
 * - Keyed by Express's resolved req.ip with /56 IPv6 subnet normalization.
 */
const uploadIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  message: { message: 'Too many resume uploads from this IP address. Please try again later.' },
  ipv6Subnet: 56,
});

/**
 * User rate limiter for POST /api/resumes (Upload):
 * - 10 requests per 15 minutes per authenticated user.
 * - Evaluated before Multer file-buffer allocation to protect memory and storage quotas.
 * - Keyed by req.userId (with defensive ipKeyGenerator(req.ip, 56) fallback).
 */
const uploadUserLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: { message: 'Too many resume uploads. Please try again later.' },
  keyGenerator: (req) => {
    return req.userId ? req.userId.toString() : ipKeyGenerator(req.ip, 56);
  },
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  analysisLimiter,
  globalAnalysisLimiter,
  uploadIpLimiter,
  uploadUserLimiter,
};

