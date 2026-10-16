/**
 * Custom application error class for operational errors with specific HTTP status codes.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 handler for unmatched routes.
 * Returns consistent JSON response without reflecting arbitrary request input.
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    message: 'Route not found',
  });
};

/**
 * Sanitizes request metadata for safe server-side logging without credential leakage.
 *
 * @param {object} req - Express request object
 * @returns {object} Sanitized request metadata
 */
const sanitizeLogContext = (req) => {
  if (!req) return {};
  // Extract path strictly without query parameters
  let cleanPath = req.path;
  if (!cleanPath && req.originalUrl) {
    cleanPath = req.originalUrl.split('?')[0];
  } else if (!cleanPath && req.url) {
    cleanPath = req.url.split('?')[0];
  }

  return {
    method: req.method || 'UNKNOWN',
    path: cleanPath || '/',
    ip: req.ip,
  };
};

/**
 * Centralized error-handling middleware.
 * Maps known errors conservatively and returns safe, sanitized JSON responses.
 * Never exposes stack traces, internal paths, database details, or secrets to the client.
 *
 * @param {Error} err - Error object
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  // Fix 1: If headers have already been sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = 500;
  let clientMessage = 'Internal server error';

  // Standard safe messages for unclassified 4xx client status codes
  const SAFE_4XX_MESSAGES = {
    400: 'Bad request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Resource not found',
    405: 'Method not allowed',
    409: 'Conflict',
    422: 'Unprocessable entity',
    429: 'Too many requests',
  };

  // 1. JSON parsing syntax error
  if (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && 'body' in err) {
    statusCode = 400;
    clientMessage = 'Invalid JSON payload';
  }
  // 2. Mongoose CastError (invalid ObjectId / type cast)
  else if (err.name === 'CastError') {
    statusCode = 400;
    clientMessage = 'Invalid resource ID format';
  }
  // 3. Mongoose ValidationError: sanitize field-level messages without reflecting user values or arbitrary validator text
  else if (err.name === 'ValidationError' && err.errors) {
    statusCode = 400;
    const messages = [];
    for (const [field, subErr] of Object.entries(err.errors)) {
      if (!subErr) continue;

      if (subErr.kind === 'required') {
        messages.push(`${field} is required`);
      } else if (subErr.kind === 'minlength') {
        messages.push(`${field} does not meet the minimum length requirement`);
      } else if (subErr.kind === 'maxlength') {
        messages.push(`${field} exceeds the maximum length requirement`);
      } else if (subErr.kind === 'enum') {
        messages.push(`Invalid value for ${field}`);
      } else if (subErr.value !== undefined) {
        // User-supplied value was rejected; emit safe controlled feedback without reflecting value
        messages.push(`Invalid value for ${field}`);
      } else if (
        typeof subErr.message === 'string' &&
        /^[A-Za-z0-9 _.,-]{1,80}$/.test(subErr.message.trim()) &&
        !/with value/i.test(subErr.message) &&
        !/value/i.test(subErr.message)
      ) {
        // Safe static schema validation message (e.g. "Company name is required", "Job title cannot be empty")
        messages.push(subErr.message.trim());
      } else {
        messages.push(`Invalid value for ${field}`);
      }
    }
    clientMessage = messages.length > 0 ? messages.join(', ') : 'Validation error';
  }
  // 4. MongoDB Duplicate Key error (E11000 / E11001)
  else if (err.code === 11000 || err.code === 11001) {
    statusCode = 409;
    if (err.keyValue && typeof err.keyValue === 'object') {
      const keys = Object.keys(err.keyValue);
      if (keys.includes('email')) {
        clientMessage = 'Email is already registered';
      } else if (keys.length > 0) {
        clientMessage = `Duplicate value for field: ${keys[0]}`;
      } else {
        clientMessage = 'Duplicate resource value entered';
      }
    } else {
      clientMessage = 'Duplicate resource value entered';
    }
  }
  // 5. Multer file upload errors
  else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    clientMessage = 'File size exceeds limit of 10MB';
  } else if (err.code === 'INVALID_FILE_TYPE') {
    statusCode = 400;
    clientMessage = 'Only PDF files are allowed';
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    clientMessage = 'Unexpected field in form upload';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    clientMessage = 'File upload error';
  }
  // 6. JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    clientMessage = 'Unauthorized: Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    clientMessage = 'Unauthorized: Token has expired';
  }
  // 7. Explicit operational AppError with safe application-defined message
  else if (
    err instanceof AppError &&
    typeof err.statusCode === 'number' &&
    err.statusCode >= 400 &&
    err.statusCode < 500
  ) {
    statusCode = err.statusCode;
    clientMessage = typeof err.message === 'string' && err.message.trim().length > 0
      ? err.message.trim()
      : (SAFE_4XX_MESSAGES[statusCode] || 'Bad request');
  }
  // 8. Unclassified 4xx errors: provide standard safe message without reflecting raw third-party text
  else if (
    (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) ||
    (typeof err.status === 'number' && err.status >= 400 && err.status < 500)
  ) {
    statusCode = typeof err.statusCode === 'number' ? err.statusCode : err.status;
    clientMessage = SAFE_4XX_MESSAGES[statusCode] || 'Bad request';
  }
  // 9. Unexpected 500 error: generic response
  else {
    statusCode = 500;
    clientMessage = 'Internal server error';
  }

  // Server-side diagnostic logging:
  // - Never log arbitrary err.message, err.stack, nested error objects, or raw inputs
  // - For 5xx: log fixed diagnostic message with safe request metadata
  // - For client errors: log safe, controlled clientMessage
  const logContext = sanitizeLogContext(req);
  if (statusCode >= 500) {
    console.error(`[Server Error] ${logContext.method} ${logContext.path} -> ${statusCode}: Unexpected server error`);
  } else {
    console.error(`[Client Error] ${logContext.method} ${logContext.path} -> ${statusCode}: ${clientMessage}`);
  }

  // Response strictly formatted with sanitized message - NEVER returns raw stack, internal paths, or secrets
  return res.status(statusCode).json({
    message: clientMessage,
  });
};

module.exports = {
  AppError,
  notFoundHandler,
  errorHandler,
  sanitizeLogContext,
};
