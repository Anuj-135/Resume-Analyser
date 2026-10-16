const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { notFoundHandler, errorHandler, AppError } = require('../server/middleware/errorHandler');
const { register, login, logout, me } = require('../server/controllers/authController');
const { createResume, getResumes, getResumeById, deleteResume, deleteAllResumes, analyzeResume } = require('../server/controllers/resumeController');
const { getProfileAnalytics } = require('../server/controllers/profileController');
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');

let passedCount = 0;
let failedCount = 0;

const runTest = async (name, testFn) => {
  try {
    await testFn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failedCount++;
  }
};

/**
 * Helper to make an HTTP request to a local test server.
 *
 * @param {http.Server} server
 * @param {object} options
 * @param {string|Buffer} [body]
 * @returns {Promise<{ statusCode: number, headers: object, body: string, json: object|null }>}
 */
const makeRequest = (server, options, body = null) => {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const reqOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {
          // not JSON
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
};

/**
 * Creates and starts an isolated Express test server.
 */
const startTestServer = (configureApp) => {
  return new Promise((resolve) => {
    const app = express();
    configureApp(app);
    const server = app.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
};

/**
 * Builds a standard test app with Helmet, parsers, and custom routes.
 */
const buildStandardApp = (customRoutes = () => {}) => {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: {
        maxAge: 15552000,
        includeSubDomains: false,
      },
    })
  );

  app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  // Existing standard health check
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      message: 'Server is healthy',
      timestamp: new Date().toISOString(),
    });
  });

  // Attach any test routes
  customRoutes(app);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler);

  return app;
};

// Silence console.error during expected error tests to keep test output clean
const originalConsoleError = console.error;
const quietConsole = () => {
  console.error = () => {};
};
const restoreConsole = () => {
  console.error = originalConsoleError;
};

console.log('====================================================');
console.log('Step 1.2: Security Headers & Error Handling Tests');
console.log('====================================================\n');

(async () => {
  // Test 1: Helmet security headers presence and configuration
  await runTest('Test 1 — Helmet applies secure baseline headers to responses', async () => {
    const app = buildStandardApp();
    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/api/health' });

      // Check essential security headers
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
      assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.strictEqual(res.headers['x-download-options'], 'noopen');
      assert.strictEqual(res.headers['x-permitted-cross-domain-policies'], 'none');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
      assert.strictEqual(res.headers['strict-transport-security'], 'max-age=15552000');

      // Verify x-powered-by is removed
      assert.strictEqual(res.headers['x-powered-by'], undefined, 'x-powered-by header must be removed');

      // Verify CSP is disabled for API
      assert.strictEqual(res.headers['content-security-policy'], undefined, 'CSP should be disabled for pure JSON API');
    } finally {
      server.close();
    }
  });

  // Test 2: Existing health check route remains unaffected
  await runTest('Test 2 — Health check route /api/health responds with status 200 and expected payload', async () => {
    const app = buildStandardApp();
    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/api/health' });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.json, 'Response must be JSON');
      assert.strictEqual(res.json.status, 'ok');
      assert.strictEqual(res.json.message, 'Server is healthy');
      assert.ok(res.json.timestamp, 'Timestamp must be present');
    } finally {
      server.close();
    }
  });

  // Test 3: Unmatched route returns consistent 404 JSON response
  await runTest('Test 3 — Unmatched route returns 404 JSON with generic message without reflecting input', async () => {
    const app = buildStandardApp();
    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const sensitivePath = '/api/unmatched-endpoint-xyz?secret=LEAKED_TOKEN_123';
      const res = await makeRequest(server, { path: sensitivePath });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(res.json, 'Response must be JSON');
      assert.strictEqual(res.json.message, 'Route not found');

      // Fix 3: Assert Helmet defensive headers are present on 404 error response
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', '404 must have x-content-type-options: nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN', '404 must have x-frame-options: SAMEORIGIN');
      assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin', '404 must have CORP header');

      // Ensure no reflection of URL or query params in response body
      assert.strictEqual(res.body.includes('LEAKED_TOKEN_123'), false, 'Query param must not be reflected');
      assert.strictEqual(res.body.includes('unmatched-endpoint-xyz'), false, 'Path must not be reflected');
    } finally {
      server.close();
    }
  });

  // Test 4: Unmatched POST route returns 404 JSON with Helmet headers
  await runTest('Test 4 — Unmatched POST route returns consistent 404 JSON with Helmet headers', async () => {
    const app = buildStandardApp();
    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/api/unknown-post', method: 'POST' });
      assert.strictEqual(res.statusCode, 404);
      assert.ok(res.json, 'Response must be JSON');
      assert.strictEqual(res.json.message, 'Route not found');

      // Fix 3: Assert Helmet headers on POST 404 response
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'SAMEORIGIN');
    } finally {
      server.close();
    }
  });

  // Test 5: Malformed JSON payload returns 400
  await runTest('Test 5 — Malformed JSON payload is caught and mapped to 400 Bad Request', async () => {
    quietConsole();
    const app = buildStandardApp();
    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(
        server,
        {
          path: '/api/health', // any path that hits body parser
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        '{"invalid": json syntax oops'
      );

      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.json, 'Response must be JSON');
      assert.strictEqual(res.json.message, 'Invalid JSON payload');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 6: Mongoose CastError mapping
  await runTest('Test 6 — Mongoose CastError is safely mapped to 400 Bad Request', async () => {
    quietConsole();
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/cast-error', (req, res, next) => {
        const error = new Error('Cast to ObjectId failed for value "invalid-id" at path "_id" for model "Resume"');
        error.name = 'CastError';
        error.path = '_id';
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/cast-error' });
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.json);
      assert.strictEqual(res.json.message, 'Invalid resource ID format');
      assert.strictEqual(res.body.includes('invalid-id'), false, 'Internal ID should not be leaked');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 7: Mongoose ValidationError mapping
  await runTest('Test 7 — Mongoose ValidationError is safely mapped to 400 with clean field messages', async () => {
    quietConsole();
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/validation-error', (req, res, next) => {
        const error = new Error('Resume validation failed');
        error.name = 'ValidationError';
        error.errors = {
          companyName: { message: 'Company name is required' },
          jobTitle: { message: 'Job title cannot be empty' },
        };
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/validation-error' });
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.json);
      assert.ok(res.json.message.includes('Company name is required'));
      assert.ok(res.json.message.includes('Job title cannot be empty'));
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 8: MongoDB duplicate key error mapping (409)
  await runTest('Test 8 — MongoDB duplicate key error is mapped to 409 Conflict with safe message', async () => {
    quietConsole();
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/dup-email', (req, res, next) => {
        const error = new Error('E11000 duplicate key error collection: resume.users index: email_1');
        error.code = 11000;
        error.keyValue = { email: 'user@example.com' };
        next(error);
      });

      appInstance.get('/test/dup-generic', (req, res, next) => {
        const error = new Error('E11000 duplicate key error');
        error.code = 11000;
        error.keyValue = { slug: 'sample-resume' };
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      // Email duplicate
      const res1 = await makeRequest(server, { path: '/test/dup-email' });
      assert.strictEqual(res1.statusCode, 409);
      assert.ok(res1.json);
      assert.strictEqual(res1.json.message, 'Email is already registered');

      // Generic duplicate field
      const res2 = await makeRequest(server, { path: '/test/dup-generic' });
      assert.strictEqual(res2.statusCode, 409);
      assert.ok(res2.json);
      assert.strictEqual(res2.json.message, 'Duplicate value for field: slug');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 9: Multer upload errors mapping (400)
  await runTest('Test 9 — Multer upload errors are safely mapped to 400 Bad Request', async () => {
    quietConsole();
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/multer-size', (req, res, next) => {
        const error = new Error('File too large');
        error.code = 'LIMIT_FILE_SIZE';
        next(error);
      });

      appInstance.get('/test/multer-type', (req, res, next) => {
        const error = new Error('Only PDF files are allowed');
        error.code = 'INVALID_FILE_TYPE';
        next(error);
      });

      appInstance.get('/test/multer-field', (req, res, next) => {
        const error = new Error('Unexpected field');
        error.code = 'LIMIT_UNEXPECTED_FILE';
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res1 = await makeRequest(server, { path: '/test/multer-size' });
      assert.strictEqual(res1.statusCode, 400);
      assert.strictEqual(res1.json.message, 'File size exceeds limit of 10MB');

      const res2 = await makeRequest(server, { path: '/test/multer-type' });
      assert.strictEqual(res2.statusCode, 400);
      assert.strictEqual(res2.json.message, 'Only PDF files are allowed');

      const res3 = await makeRequest(server, { path: '/test/multer-field' });
      assert.strictEqual(res3.statusCode, 400);
      assert.strictEqual(res3.json.message, 'Unexpected field in form upload');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 10: JWT error mappings (401)
  await runTest('Test 10 — JWT errors are mapped to 401 Unauthorized', async () => {
    quietConsole();
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/jwt-invalid', (req, res, next) => {
        const error = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        next(error);
      });

      appInstance.get('/test/jwt-expired', (req, res, next) => {
        const error = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res1 = await makeRequest(server, { path: '/test/jwt-invalid' });
      assert.strictEqual(res1.statusCode, 401);
      assert.strictEqual(res1.json.message, 'Unauthorized: Invalid token');

      const res2 = await makeRequest(server, { path: '/test/jwt-expired' });
      assert.strictEqual(res2.statusCode, 401);
      assert.strictEqual(res2.json.message, 'Unauthorized: Token has expired');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 11: Unexpected 500 error in production returns generic message without stack trace or secrets
  await runTest('Test 11 — Unexpected 500 error returns generic message without leaking secrets or stack trace to client or logs', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const dummyDbUser = 'admin_user';
    const dummyDbPass = 'SUPER_SECRET_DB_PASS_XYZ99';
    const secretUri = `mongodb+srv://${dummyDbUser}:${dummyDbPass}@cluster0.net/prod_db`;
    const secretApiKey = 'GEMINI_SECRET_KEY_SECRET_VALUE_123';
    const secretBearerToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_secret_jwt_payload.dummy_signature';

    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/crash', (req, res, next) => {
        const error = new Error(`Connection failed to ${secretUri} with auth ${secretBearerToken}`);
        error.secretKey = secretApiKey;
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/crash' });
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.json);
      assert.strictEqual(res.json.message, 'Internal server error');

      // Verify zero leakage of secrets, stack trace, or internal paths in client response
      assert.strictEqual(res.json.stack, undefined, 'Stack trace must NEVER be in response');
      assert.strictEqual(res.body.includes(secretUri), false, 'DB URI must NEVER be leaked in response');
      assert.strictEqual(res.body.includes(dummyDbPass), false, 'DB Password must NEVER be leaked in response');
      assert.strictEqual(res.body.includes(secretApiKey), false, 'API key must NEVER be leaked in response');
      assert.strictEqual(res.body.includes('dummy_secret_jwt_payload'), false, 'Bearer token must NEVER be leaked in response');
      assert.strictEqual(res.body.includes('node_modules'), false, 'File paths must not be leaked in response');

      // Verify zero leakage in server console logs and confirm safe generic log
      const fullLogText = logs.join('\n');
      assert.strictEqual(fullLogText.includes(dummyDbPass), false, 'DB password must NOT appear in server console logs');
      assert.strictEqual(fullLogText.includes(dummyDbUser), false, 'DB username must NOT appear in server console logs');
      assert.strictEqual(fullLogText.includes(secretApiKey), false, 'API key must NOT appear in server console logs');
      assert.strictEqual(fullLogText.includes('dummy_secret_jwt_payload'), false, 'Bearer token must NOT appear in server console logs');
      assert.ok(
        fullLogText.includes('[Server Error] GET /test/crash -> 500: Unexpected server error'),
        'Server log must use safe fixed message for 500 errors'
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      restoreConsole();
      server.close();
    }
  });

  // Test 12: Unexpected 500 error in development also never exposes stack trace or secrets to client or logs
  await runTest('Test 12 — Unexpected 500 error in development still returns sanitized JSON without secret leakage in response or logs', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const secretToken = 'JWT_SECRET_VERY_SECRET_KEY_DEV_9988';

    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/dev-crash', (req, res, next) => {
        const error = new Error(`Unexpected internal computation failure with token ${secretToken}`);
        error.token = secretToken;
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/dev-crash' });
      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.json);
      assert.strictEqual(res.json.message, 'Internal server error');
      assert.strictEqual(res.json.stack, undefined, 'Stack trace must not be sent to client');
      assert.strictEqual(res.body.includes(secretToken), false, 'Secret token must not be sent to client');

      const fullLogText = logs.join('\n');
      assert.strictEqual(fullLogText.includes(secretToken), false, 'Secret token must not appear in server logs');
      assert.ok(fullLogText.includes('[Server Error] GET /test/dev-crash -> 500: Unexpected server error'));
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      restoreConsole();
      server.close();
    }
  });

  // Test 13: Operational AppError with custom status code
  await runTest('Test 13 — Operational AppError returns defined status code and message in response and logs safe client message', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/operational-error', (req, res, next) => {
        next(new AppError('Payment required to access premium analysis', 402));
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/operational-error' });
      assert.strictEqual(res.statusCode, 402);
      assert.ok(res.json);
      assert.strictEqual(res.json.message, 'Payment required to access premium analysis');

      const fullLogText = logs.join('\n');
      assert.ok(fullLogText.includes('[Client Error] GET /test/operational-error -> 402: Payment required to access premium analysis'));
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 14 (Fix 1): Delegation when headers already sent
  await runTest('Test 14 — errorHandler delegates using next(err) when headers have already been sent', async () => {
    let nextCalledWith = null;
    const sampleError = new Error('Post-streaming error');
    const mockReq = { method: 'GET', path: '/test' };
    const mockRes = {
      headersSent: true,
      status: () => {
        throw new Error('res.status() should NOT be called when headers have already been sent');
      },
      json: () => {
        throw new Error('res.json() should NOT be called when headers have already been sent');
      },
    };
    const mockNext = (err) => {
      nextCalledWith = err;
    };

    errorHandler(sampleError, mockReq, mockRes, mockNext);
    assert.strictEqual(nextCalledWith, sampleError, 'errorHandler must delegate to next(err) when headersSent is true');
  });

  // Test 15 (Fix 2): Sensitive query parameter is stripped from logged path
  await runTest('Test 15 — Server log context strips query strings and does not leak sensitive query parameters', async () => {
    const logs = [];
    const captureConsole = (...args) => logs.push(args.join(' '));
    console.error = captureConsole;

    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/sensitive-query', (req, res, next) => {
        next(new Error('Triggered error for log check'));
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const dummySecretQuery = 'SUPER_SECRET_SESSION_TOKEN_XYZ9988';
      await makeRequest(server, { path: `/test/sensitive-query?token=${dummySecretQuery}&apiKey=SECRET123` });

      const fullLogText = logs.join('\n');
      assert.strictEqual(
        fullLogText.includes(dummySecretQuery),
        false,
        'Sensitive query token must NOT appear in server console logs'
      );
      assert.strictEqual(
        fullLogText.includes('SECRET123'),
        false,
        'API key query parameter must NOT appear in server console logs'
      );
      assert.ok(
        fullLogText.includes('/test/sensitive-query'),
        'Clean pathname without query string must still be logged for diagnostics'
      );
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 16 (Fix 4): Mongoose validation error does not reflect user-supplied sensitive values
  await runTest('Test 16 — Mongoose validation error does not reflect user-supplied sensitive values in client response', async () => {
    quietConsole();
    const sensitiveValue = 'DUMMY_SECRET_USER_INPUT_PASSWORD_9988';
    const app = buildStandardApp((appInstance) => {
      appInstance.post('/test/mongoose-sensitive-val', (req, res, next) => {
        const error = new Error(`User validation failed: password: Path \`password\` (\`${sensitiveValue}\`) is shorter than minimum length (8).`);
        error.name = 'ValidationError';
        error.errors = {
          password: {
            path: 'password',
            kind: 'minlength',
            value: sensitiveValue,
            message: `Path \`password\` (\`${sensitiveValue}\`) is shorter than minimum length (8).`,
          },
        };
        next(error);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/mongoose-sensitive-val', method: 'POST' });
      assert.strictEqual(res.statusCode, 400);
      assert.ok(res.json);
      assert.strictEqual(
        res.body.includes(sensitiveValue),
        false,
        'User-supplied sensitive value must NEVER be reflected in client error response'
      );
      assert.strictEqual(res.json.message, 'password does not meet the minimum length requirement');
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 17: Unclassified 4xx error receives safe standardized response without leaking third-party error text in response or logs
  await runTest('Test 17 — Unclassified 4xx error receives safe standardized response and never reflects third-party secrets in response or logs', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const secret4xxKey = 'SECRET_STRIPE_OR_THIRD_PARTY_API_KEY_4XX_VAL_999';
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/unclassified-400', (req, res, next) => {
        const err = new Error(`External service rejected request with key: ${secret4xxKey}`);
        err.statusCode = 400; // unclassified 400 error, not an AppError
        next(err);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/unclassified-400' });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json.message, 'Bad request');

      // Assert neither response body nor logs contain the secret
      assert.strictEqual(res.body.includes(secret4xxKey), false, 'Client response must NOT contain 4xx error secret');
      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secret4xxKey), false, 'Server logs must NOT contain 4xx error secret');
      assert.ok(logText.includes('[Client Error] GET /test/unclassified-400 -> 400: Bad request'));
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 18: Unclassified 403 error receives safe Forbidden response without leaking internal error message
  await runTest('Test 18 — Unclassified 403 error receives safe Forbidden response and does not leak internal error message', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const secretArn = 'arn:aws:iam::123456789012:role/SecretRole';
    const app = buildStandardApp((appInstance) => {
      appInstance.get('/test/unclassified-403', (req, res, next) => {
        const err = new Error(`Access denied for ${secretArn}`);
        err.status = 403;
        next(err);
      });
    });

    const server = await new Promise((res) => {
      const s = app.listen(0, '127.0.0.1', () => res(s));
    });

    try {
      const res = await makeRequest(server, { path: '/test/unclassified-403' });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.json.message, 'Forbidden');
      assert.strictEqual(res.body.includes(secretArn), false, 'Client response must NOT contain internal ARN');
      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secretArn), false, 'Server logs must NOT contain internal ARN');
      assert.ok(logText.includes('[Client Error] GET /test/unclassified-403 -> 403: Forbidden'));
    } finally {
      restoreConsole();
      server.close();
    }
  });

  // Test 19: authController delegates unexpected errors to next(err) without logging raw error objects
  await runTest('Test 19 — authController delegates unexpected errors to next(err) without logging raw error objects', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const secretDbVal = 'DUMMY_DB_AUTH_SECRET_XYZ999';
    const originalFindOne = User.findOne;
    User.findOne = () => Promise.reject(new Error(`Database timeout connection to ${secretDbVal}`));

    let nextCalledWith = null;
    const mockReq = { body: { name: 'Test', email: 'test@example.com', password: 'password123' } };
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
      cookie: () => {},
    };
    const mockNext = (err) => {
      nextCalledWith = err;
    };

    try {
      await register(mockReq, mockRes, mockNext);
      assert.ok(nextCalledWith, 'register must call next(err) on unhandled error');
      assert.strictEqual(nextCalledWith.message.includes(secretDbVal), true);
      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secretDbVal), false, 'Raw error secret must NOT be logged in controller');
    } finally {
      User.findOne = originalFindOne;
      restoreConsole();
    }
  });

  // Test 20: authController fallback when next is omitted logs safe fixed message and no raw error object
  await runTest('Test 20 — authController fallback when next is omitted logs safe fixed message and no raw error object', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const secretDbVal = 'DUMMY_LOGIN_SECRET_TOKEN_7788';
    const originalFindOne = User.findOne;
    User.findOne = () => Promise.reject(new Error(`Login failure with secret ${secretDbVal}`));

    let responseStatus = null;
    let responseJson = null;
    const mockReq = { body: { email: 'user@example.com', password: 'password123' } };
    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data) => {
        responseJson = data;
        return mockRes;
      },
    };

    try {
      await login(mockReq, mockRes);
      assert.strictEqual(responseStatus, 500);
      assert.strictEqual(responseJson.message, 'Server error during login');
      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secretDbVal), false, 'Raw error secret must NOT be logged in controller fallback');
      assert.ok(logText.includes('[Auth Error] Login failure'), 'Must log fixed safe diagnostic message');
    } finally {
      User.findOne = originalFindOne;
      restoreConsole();
    }
  });

  // Test 21: resumeController cleanup and catch blocks do not leak credentials in logs
  await runTest('Test 21 — resumeController catch blocks and Cloudinary cleanup do not leak raw error objects or credentials', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const originalDeletePdfAsset = cloudinaryService.deletePdfAsset;
    const originalFindOneAndDelete = Resume.findOneAndDelete;

    const secretCloudinaryKey = 'CLOUDINARY_API_SECRET_LEAK_FAIL_VAL_99';
    cloudinaryService.deletePdfAsset = () => Promise.reject(new Error(`Cloudinary HTTP 500 with secret ${secretCloudinaryKey}`));
    Resume.findOneAndDelete = () => Promise.resolve({ _id: '507f1f77bcf86cd799439011', resumePublicId: 'sample-asset-id', userId: 'user1' });

    const mockReq = { params: { id: '507f1f77bcf86cd799439011' }, userId: 'user1' };
    let responseStatus = null;
    let responseJson = null;
    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return mockRes;
      },
      json: (data) => {
        responseJson = data;
        return mockRes;
      },
    };

    try {
      await deleteResume(mockReq, mockRes);
      assert.strictEqual(responseStatus, 200);
      assert.strictEqual(responseJson.message, 'Resume deleted successfully');

      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secretCloudinaryKey), false, 'Cloudinary cleanup must NOT leak secret in logs');
      assert.ok(logText.includes('[Cloudinary Cleanup] Failed to delete asset during resume deletion'), 'Must log safe cleanup message');
    } finally {
      cloudinaryService.deletePdfAsset = originalDeletePdfAsset;
      Resume.findOneAndDelete = originalFindOneAndDelete;
      restoreConsole();
    }
  });

  // Test 22: profileController delegates unhandled errors to next(err) without logging raw error objects
  await runTest('Test 22 — profileController delegates unhandled errors to next(err) without logging raw error objects', async () => {
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));

    const secretProfileDb = 'PROFILE_DATABASE_SECRET_TOKEN_4433';
    const originalFindById = User.findById;
    User.findById = () => ({
      select: () => Promise.reject(new Error(`Profile DB query failed: ${secretProfileDb}`)),
    });

    let nextCalledWith = null;
    const mockReq = { userId: '507f1f77bcf86cd799439011' };
    const mockRes = {
      status: () => mockRes,
      json: () => mockRes,
    };
    const mockNext = (err) => {
      nextCalledWith = err;
    };

    try {
      await getProfileAnalytics(mockReq, mockRes, mockNext);
      assert.ok(nextCalledWith, 'profileController must delegate to next(err)');
      assert.strictEqual(nextCalledWith.message.includes(secretProfileDb), true);
      const logText = logs.join('\n');
      assert.strictEqual(logText.includes(secretProfileDb), false, 'Raw profile error must NOT be logged in controller');
    } finally {
      User.findById = originalFindById;
      restoreConsole();
    }
  });

  console.log('\n====================================================');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
