const { AppError } = require('./errorHandler');

/**
 * Higher-order middleware factory for validating request components against Zod schemas.
 *
 * @param {object} [schemas={}]
 * @param {import('zod').ZodType} [schemas.body]
 * @param {import('zod').ZodType} [schemas.params]
 * @param {import('zod').ZodType} [schemas.query]
 * @returns {import('express').RequestHandler}
 */
const validate = ({ body, params, query } = {}) => {
  return (req, res, next) => {
    const targets = [
      { name: 'body', schema: body, data: req.body, label: 'Request body' },
      { name: 'params', schema: params, data: req.params, label: 'Route parameters' },
      { name: 'query', schema: query, data: req.query, label: 'Query parameters' },
    ];

    if (!req.validated) {
      req.validated = {};
    }

    for (const target of targets) {
      if (!target.schema) continue;

      // Explicitly reject missing, null, or non-object input without silent {} masking
      if (
        target.data === undefined ||
        target.data === null ||
        typeof target.data !== 'object'
      ) {
        return next(new AppError(`${target.label} must be a valid object`, 400));
      }

      const result = target.schema.safeParse(target.data);

      if (!result.success) {
        // Extract clean field-level error messages without reflecting submitted values
        const errorMessages = result.error.issues.map((issue) => issue.message);

        const formattedMessage = errorMessages.length > 0
          ? errorMessages.join(', ')
          : 'Invalid request input';

        // Delegate cleanly to centralized errorHandler via AppError(message, 400)
        return next(new AppError(formattedMessage, 400));
      }

      // Store in dedicated validated container
      req.validated[target.name] = result.data;

      // Safely synchronize parsed/sanitized output back to Express request properties
      if (target.name === 'body') {
        req.body = result.data;
      } else if (target.name === 'params') {
        if (req.params && typeof req.params === 'object') {
          Object.assign(req.params, result.data);
        } else {
          req.params = result.data;
        }
      } else if (target.name === 'query') {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    next();
  };
};

module.exports = validate;
