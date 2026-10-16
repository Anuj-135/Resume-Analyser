const { z } = require('zod');

/**
 * Pre-processes a raw environment dictionary:
 * - Trims string values
 * - Converts empty or whitespace-only strings to undefined so Zod defaults apply cleanly
 *
 * @param {object} rawEnv - Raw environment dictionary
 * @returns {object} Cleaned environment dictionary
 */
const cleanEnvObject = (rawEnv) => {
  if (!rawEnv || typeof rawEnv !== 'object') return {};
  const cleaned = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === 'string' && value.trim() === '') {
      cleaned[key] = undefined;
    } else if (typeof value === 'string') {
      cleaned[key] = value.trim();
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

/**
 * Zod schema defining the environment contract for the application.
 * Distinguishes between development, test, and production constraints.
 */
const envSchema = z
  .object({
    RENDER: z
      .union([z.string(), z.boolean()])
      .optional()
      .transform((v) => v === true || v === 'true' || v === '1'),

    NODE_ENV: z
      .enum(['development', 'production', 'test'], {
        message: 'NODE_ENV must be one of: development, production, test',
      })
      .optional(),

    PORT: z
      .union([z.string(), z.number()])
      .optional()
      .default(5000)
      .transform((val, ctx) => {
        const parsed = typeof val === 'number' ? val : parseInt(val, 10);
        if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'PORT must be an integer between 1 and 65535',
          });
          return z.NEVER;
        }
        return parsed;
      }),

    MONGODB_URI: z
      .string({ message: 'MONGODB_URI is required' })
      .min(1, 'MONGODB_URI cannot be empty')
      .regex(
        /^mongodb(\+srv)?:\/\/.+/i,
        'MONGODB_URI must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://'
      ),

    CLIENT_URL: z
      .string()
      .default('http://localhost:3000')
      .refine(
        (val) => {
          try {
            new URL(val);
            return true;
          } catch {
            return false;
          }
        },
        {
          message: 'CLIENT_URL must be a valid URL string (e.g. http://localhost:3000 or https://example.com)',
        }
      ),

    JWT_SECRET: z
      .string({ message: 'JWT_SECRET is required' })
      .min(1, 'JWT_SECRET cannot be empty'),

    JWT_EXPIRES_IN: z
      .string()
      .min(1, 'JWT_EXPIRES_IN cannot be empty')
      .default('7d'),

    GEMINI_API_KEY: z.string().optional(),

    GEMINI_MODEL: z
      .string()
      .min(1, 'GEMINI_MODEL cannot be empty')
      .default('gemini-3.8-flash'),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
  })
  .transform((data) => ({
    ...data,
    NODE_ENV: data.NODE_ENV || (data.RENDER ? undefined : 'development'),
  }))
  .superRefine((data, ctx) => {
    // Render deployment guard: enforce explicit NODE_ENV=production
    if (data.RENDER) {
      if (!data.NODE_ENV) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['NODE_ENV'],
          message:
            "NODE_ENV must be explicitly set to 'production' when running on Render (currently missing or empty)",
        });
      } else if (data.NODE_ENV !== 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['NODE_ENV'],
          message: `NODE_ENV must be explicitly set to 'production' when running on Render (cannot be '${data.NODE_ENV}')`,
        });
      }
    }

    const isProd = data.NODE_ENV === 'production';

    // In production, JWT_SECRET must have at least 32 characters
    if (isProd) {
      if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: `JWT_SECRET must be at least 32 characters long in production (current length: ${data.JWT_SECRET ? data.JWT_SECRET.length : 0})`,
        });
      }

      // In production, GEMINI_API_KEY is required
      if (!data.GEMINI_API_KEY || data.GEMINI_API_KEY.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GEMINI_API_KEY'],
          message: 'GEMINI_API_KEY is required in production',
        });
      }

      // In production, Cloudinary credentials are required and cannot be placeholders
      const cloudFields = [
        { name: 'CLOUDINARY_CLOUD_NAME', val: data.CLOUDINARY_CLOUD_NAME },
        { name: 'CLOUDINARY_API_KEY', val: data.CLOUDINARY_API_KEY },
        { name: 'CLOUDINARY_API_SECRET', val: data.CLOUDINARY_API_SECRET },
      ];

      for (const field of cloudFields) {
        if (!field.val || field.val.trim() === '' || field.val === 'placeholder') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.name],
            message: `${field.name} is required and cannot be empty or "placeholder" in production`,
          });
        }
      }
    } else {
      // In development / test, enforce at least 8 characters if JWT_SECRET is provided
      if (data.JWT_SECRET && data.JWT_SECRET.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET should be at least 8 characters long in development',
        });
      }
    }
  });

/**
 * Formats Zod validation issues into non-sensitive, actionable error messages.
 * Never prints values of secrets or sensitive tokens.
 *
 * @param {Array<z.ZodIssue>} issues
 * @returns {Array<{ field: string, message: string }>}
 */
const formatValidationErrors = (issues) => {
  return issues.map((issue) => {
    const field = issue.path && issue.path.length > 0 ? issue.path.join('.') : 'environment';
    return {
      field,
      message: issue.message,
    };
  });
};

/**
 * Pure parsing function for testing and validation.
 *
 * @param {object} [rawEnv=process.env] - Raw environment dictionary
 * @returns {{ success: boolean, data?: object, errors?: Array<{ field: string, message: string }> }}
 */
const parseEnv = (rawEnv = process.env) => {
  const cleaned = cleanEnvObject(rawEnv);
  const result = envSchema.safeParse(cleaned);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    errors: formatValidationErrors(result.error.issues),
  };
};

/**
 * Validates process.env at application startup.
 * If validation fails, logs sanitized error messages and terminates the process.
 * If validation succeeds, synchronizes validated defaults back onto process.env.
 *
 * @param {object} [rawEnv=process.env]
 * @param {object} [options={ exitOnError: true }]
 * @returns {object} Validated environment data
 */
const validateEnv = (rawEnv = process.env, options = { exitOnError: true }) => {
  const result = parseEnv(rawEnv);

  if (!result.success) {
    console.error('\n====================================================');
    console.error('❌ SERVER CONFIGURATION ERROR: Invalid Environment');
    console.error('====================================================');
    console.error('The following environment variables failed validation:\n');
    result.errors.forEach((err) => {
      console.error(`  • [${err.field}]: ${err.message}`);
    });
    console.error('\nServer startup aborted. Please check your environment configuration.');
    console.error('====================================================\n');

    if (options.exitOnError) {
      process.exit(1);
    }
    const error = new Error('Environment validation failed');
    error.errors = result.errors;
    throw error;
  }

  // Synchronize validated defaults to process.env if operating on process.env
  if (rawEnv === process.env) {
    for (const [key, value] of Object.entries(result.data)) {
      if (key === 'RENDER') continue;
      if (process.env[key] === undefined || process.env[key] === '') {
        process.env[key] = String(value);
      }
    }
  }

  return result.data;
};

module.exports = {
  envSchema,
  cleanEnvObject,
  parseEnv,
  validateEnv,
  formatValidationErrors,
};
