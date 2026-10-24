const { AppError } = require('./errorHandler');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Normalizes an origin or referer URL into a standard lowercase protocol//host[:port] string.
 * Returns null if the URL is invalid, non-http(s), or malformed.
 *
 * @param {string} input - Raw origin or referer string
 * @returns {string|null} - Normalized origin or null
 */
const normalizeOrigin = (input) => {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === 'null:') return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();

    // Only accept http: and https: protocols
    if (protocol !== 'http:' && protocol !== 'https:') {
      return null;
    }

    // Determine normalized port (suppress default ports)
    let port = parsed.port;
    if (
      (protocol === 'http:' && port === '80') ||
      (protocol === 'https:' && port === '443')
    ) {
      port = '';
    }

    const portPart = port ? `:${port}` : '';
    return `${protocol}//${hostname}${portPart}`;
  } catch {
    return null;
  }
};

/**
 * Derives the explicit allowlist of trusted origins based on CLIENT_URL and explicit environment.
 *
 * @param {string} [nodeEnv=process.env.NODE_ENV] - Current NODE_ENV
 * @param {string} [clientUrl=process.env.CLIENT_URL] - Configured client URL
 * @returns {Set<string>} - Set of normalized allowed origins
 */
const getAllowlist = (nodeEnv = process.env.NODE_ENV, clientUrl = process.env.CLIENT_URL) => {
  const allowlist = new Set();

  // Add normalized CLIENT_URL if configured and valid
  if (clientUrl) {
    const normalizedClient = normalizeOrigin(clientUrl);
    if (normalizedClient) {
      allowlist.add(normalizedClient);
    }
  }

  // Explicitly permit local loopback origins only in development or test environments
  if (nodeEnv === 'development' || nodeEnv === 'test') {
    allowlist.add('http://localhost:3000');
    allowlist.add('http://127.0.0.1:3000');
    allowlist.add('http://localhost:5000');
    allowlist.add('http://127.0.0.1:5000');
  }

  return allowlist;
};

/**
 * CSRF Defense Middleware for state-changing HTTP requests.
 *
 * Security Invariants:
 * 1. Safe methods (GET, HEAD, OPTIONS) pass through without inspection.
 * 2. State-changing methods (POST, PUT, PATCH, DELETE) require custom header X-Requested-With: XMLHttpRequest.
 * 3. Strict Origin Validation is the PRIMARY defense; the custom header alone is NOT proof of trust.
 * 4. If Origin is present, it MUST match the explicit allowlist. Untrusted Origin is rejected immediately with 403;
 *    the middleware NEVER falls back to Referer when Origin is present and mismatched.
 * 5. Referer is inspected strictly and ONLY when Origin is absent.
 * 6. If both Origin and Referer are absent:
 *    - In production (or any non-dev/non-test environment), request is rejected with 403.
 *    - In explicit development or test mode, permitted if X-Requested-With is present (preserves developer CLI tools).
 * 7. Malformed, null, or untrusted origins fail safely with 403 via centralized errorHandler.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const csrfProtection = (req, res, next) => {
  const method = (req.method || '').toUpperCase();

  // 1. Safe methods bypass CSRF checks
  if (SAFE_METHODS.has(method)) {
    return next();
  }

  // Only protect known state-changing methods; unclassified methods are delegated
  if (!STATE_CHANGING_METHODS.has(method)) {
    return next();
  }

  // 2. Custom header requirement: X-Requested-With must strictly match 'XMLHttpRequest'
  const requestedWith = req.headers['x-requested-with'];
  if (
    !requestedWith ||
    typeof requestedWith !== 'string' ||
    requestedWith.trim().toLowerCase() !== 'xmlhttprequest'
  ) {
    return next(new AppError('CSRF validation failed', 403));
  }

  // 3. Strict Origin Validation (Primary Defense)
  const env = process.env.NODE_ENV;
  const isExplicitDevOrTest = env === 'development' || env === 'test';
  const allowlist = getAllowlist(env, process.env.CLIENT_URL);

  const rawOrigin = req.headers['origin'];
  const rawReferer = req.headers['referer'];

  // Explicit check for literal 'null' string or null value (sandboxed iframes, file:// schemes)
  if (rawOrigin === 'null' || rawOrigin === null) {
    return next(new AppError('CSRF validation failed', 403));
  }

  // Case A: Origin header is present
  if (typeof rawOrigin === 'string' && rawOrigin.trim() !== '') {
    const normalizedOrigin = normalizeOrigin(rawOrigin);
    if (!normalizedOrigin || !allowlist.has(normalizedOrigin)) {
      // Crucial: DO NOT fall back to Referer when Origin is present and mismatched
      return next(new AppError('CSRF validation failed', 403));
    }
    // Origin is valid and matches allowlist
    return next();
  }

  // Case B: Origin header is absent; inspect Referer
  if (typeof rawReferer === 'string' && rawReferer.trim() !== '') {
    const normalizedRefererOrigin = normalizeOrigin(rawReferer);
    if (!normalizedRefererOrigin || !allowlist.has(normalizedRefererOrigin)) {
      return next(new AppError('CSRF validation failed', 403));
    }
    // Referer origin is valid and matches allowlist
    return next();
  }

  // Case C: Both Origin and Referer are absent
  // In production (or any environment other than explicit development/test), reject immediately
  if (!isExplicitDevOrTest) {
    return next(new AppError('CSRF validation failed', 403));
  }

  // In explicit development or test mode with valid X-Requested-With, permit developer tooling (curl, Postman)
  return next();
};

module.exports = {
  csrfProtection,
  normalizeOrigin,
  getAllowlist,
  SAFE_METHODS,
  STATE_CHANGING_METHODS,
};
