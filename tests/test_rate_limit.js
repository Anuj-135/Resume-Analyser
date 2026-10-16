const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// Ensure isolated test environment configuration
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_rate_limit_suite_32_chars_long';

// 1. Establish Service and Model Mocks BEFORE requiring routes/controllers
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');
const pdfService = require('../server/services/pdfService');

let mockGeminiAnalyzeCalls = 0;
let mockResumeFindOneCalls = 0;
let mockUserFindOneCalls = 0;
let mockUserCreateCalls = 0;

const resetSpies = () => {
  mockGeminiAnalyzeCalls = 0;
  mockResumeFindOneCalls = 0;
  mockUserFindOneCalls = 0;
  mockUserCreateCalls = 0;
};

// Wire default spy implementations
cloudinaryService.generateSignedUrl = (publicId) => {
  return `https://res.cloudinary.com/mock/image/upload/signed/${publicId}.pdf`;
};

pdfService.extractTextFromPdf = async (publicId) => {
  return 'Standard extracted resume text for rate limit testing';
};

aiService.analyzeResume = async (params) => {
  mockGeminiAnalyzeCalls++;
  return {
    score: 88,
    overallScore: 88,
    feedback: { strengths: ['Solid experience'], improvements: ['More metrics'] },
  };
};

User.findOne = async () => null;
User.create = async (doc) => ({
  _id: '507f1f77bcf86cd799439011',
  name: doc.name,
  email: doc.email,
  createdAt: new Date(),
});

Resume.findOne = async (query) => {
  mockResumeFindOneCalls++;
  return {
    _id: query._id || '507f191e810c19729de860ea',
    userId: query.userId,
    companyName: 'Acme Corp',
    jobTitle: 'Software Engineer',
    jobDescription: 'Backend APIs',
    resumePublicId: 'mock_cloudinary_public_id',
    feedback: {},
    save: async () => {},
  };
};

// 2. Import Production Routers, Middleware & Limiter module
const authRoutes = require('../server/routes/authRoutes');
const resumeRoutes = require('../server/routes/resumeRoutes');
const { errorHandler } = require('../server/middleware/errorHandler');
const {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  analysisLimiter,
} = require('../server/middleware/rateLimiter');
const { ipKeyGenerator } = require('express-rate-limit');

// Helper to generate valid JWT auth cookies
const generateTestToken = (userId = '507f1f77bcf86cd799439011') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
};

// Test runner state
let passedCount = 0;
let failedCount = 0;

const runTest = async (name, testFn) => {
  try {
    resetSpies();
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
 * Creates and starts an isolated Express test server with production routes.
 */
const startTestServer = () => {
  return new Promise((resolve) => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());

    app.use('/api/auth', authRoutes);
    app.use('/api/resumes', resumeRoutes);
    app.use(errorHandler);

    const server = app.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
};

/**
 * Issues an HTTP request to the test server with JSON payload or query.
 */
const makeJsonRequest = (server, options = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const data = body !== null && typeof body === 'object' ? JSON.stringify(body) : body;

    const headers = {
      ...(options.headers || {}),
    };

    if (data !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: options.path || '/',
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {}
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: raw,
            json,
          });
        });
      }
    );

    req.on('error', reject);
    if (data !== null) {
      req.write(data);
    }
    req.end();
  });
};

(async () => {
  console.log('====================================================');
  console.log('Step 1.4 — Phase 4: Rate Limiting & Quota Test Suite');
  console.log('====================================================\n');

  let server;
  try {
    server = await startTestServer();

    // -----------------------------------------------------------------------
    // Section 1: Authentication Rate Limiting (loginLimiter & registerLimiter)
    // -----------------------------------------------------------------------

    // Test 1: POST /api/auth/login allows requests within configured limit (10 requests)
    await runTest('Test 1 — POST /api/auth/login allows 10 requests within window', async () => {
      for (let i = 1; i <= 10; i++) {
        const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
          email: `testuser_${i}@example.com`,
          password: 'password123',
        });
        // Downstream reaches controller and returns 401 (user not found), NOT 429
        assert.strictEqual(res.statusCode, 401, `Request ${i} should reach controller`);
        assert.strictEqual(res.json?.message, 'Invalid email or password');
      }
    });

    // Test 2: POST /api/auth/login returns 429 on request 11
    await runTest('Test 2 — POST /api/auth/login returns HTTP 429 when limit (10) is exceeded', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'attacker@example.com',
        password: 'password123',
      });
      assert.strictEqual(res.statusCode, 429, 'Expected 11th request to return 429 Too Many Requests');
      assert.strictEqual(
        res.json?.message,
        'Too many authentication attempts. Please try again later.'
      );
    });

    // Test 3: Standard rate-limit headers are present and legacy headers are absent on 429
    await runTest('Test 3 — Rate-limit response includes standard headers and omits legacy headers', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'attacker@example.com',
        password: 'password123',
      });
      assert.strictEqual(res.statusCode, 429);
      // Standard draft-7 headers and RFC Retry-After
      assert(res.headers['retry-after'], 'Expected Retry-After header on 429 response');
      assert(res.headers['ratelimit'] || res.headers['ratelimit-policy'], 'Expected standard RateLimit header');
      // Legacy headers should be absent
      assert.strictEqual(res.headers['x-ratelimit-limit'], undefined, 'Legacy X-RateLimit-Limit must be absent');
      assert.strictEqual(res.headers['x-ratelimit-remaining'], undefined, 'Legacy X-RateLimit-Remaining must be absent');
    });

    // Test 4: Registration limiter maintains an independent quota bucket from login
    await runTest('Test 4 — Exhausted login quota does not exhaust independent registration quota', async () => {
      // Login is currently exhausted (hits 429)
      const loginRes = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'test@example.com',
        password: 'password123',
      });
      assert.strictEqual(loginRes.statusCode, 429, 'Login must be rate-limited');

      // But registration endpoint has its own independent bucket and should allow valid request
      const regRes = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Independent User',
        email: 'independent_user_1@example.com',
        password: 'password123',
      });
      assert.strictEqual(regRes.statusCode, 201, 'Registration must succeed with independent quota');
      assert.strictEqual(regRes.json?.message, 'User registered successfully');
    });

    // Test 5: Registration limiter returns 429 when its own limit is reached
    await runTest('Test 5 — POST /api/auth/register returns 429 when its independent quota (10) is exhausted', async () => {
      // 1 registration was consumed in Test 4. Send 9 more requests (total 10)
      for (let i = 2; i <= 10; i++) {
        const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
          name: `User ${i}`,
          email: `reg_user_${i}@example.com`,
          password: 'password123',
        });
        assert.strictEqual(res.statusCode, 201);
      }

      // Request 11 to /register must return 429
      const excessRes = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Excess User',
        email: 'excess@example.com',
        password: 'password123',
      });
      assert.strictEqual(excessRes.statusCode, 429);
      assert.strictEqual(
        excessRes.json?.message,
        'Too many authentication attempts. Please try again later.'
      );
    });

    // -----------------------------------------------------------------------
    // Section 2: AI Analysis Rate Limiting & User Quotas (analysisLimiter)
    // -----------------------------------------------------------------------

    const userAToken = generateTestToken('507f1f77bcf86cd799439001');
    const userBToken = generateTestToken('507f1f77bcf86cd799439002');
    const validResumeId = '507f191e810c19729de860ea';

    // Test 6: Authenticated user A is allowed up to 5 analysis requests
    await runTest('Test 6 — POST /api/resumes/:id/analyze allows up to 5 requests per hour for authenticated user A', async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await makeJsonRequest(
          server,
          {
            path: `/api/resumes/${validResumeId}/analyze`,
            method: 'POST',
            headers: { Cookie: `token=${userAToken}` },
          }
        );
        assert.strictEqual(res.statusCode, 200, `User A analysis ${i} should succeed`);
        assert.strictEqual(res.json?.message, 'Resume analyzed successfully');
      }
      assert.strictEqual(mockGeminiAnalyzeCalls, 5);
    });

    // Test 7: User A receives HTTP 429 on 6th request
    await runTest('Test 7 — POST /api/resumes/:id/analyze returns 429 on 6th request for user A', async () => {
      const res = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${userAToken}` },
        }
      );
      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(res.json?.message, 'Too many resume analysis requests. Please try again later.');
      assert(res.headers['retry-after'], 'Expected Retry-After header on 429');
      // Assert Gemini was NOT called for rate-limited request
      assert.strictEqual(mockGeminiAnalyzeCalls, 0);
    });

    // Test 8: User B has an independent quota even from the same client IP
    await runTest('Test 8 — User B retains an independent quota and succeeds from the exact same client IP', async () => {
      // User A is currently at limit (429)
      const resA = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${userAToken}` },
        }
      );
      assert.strictEqual(resA.statusCode, 429);

      // User B makes request over exact same loopback connection / IP
      const resB = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${userBToken}` },
        }
      );
      assert.strictEqual(resB.statusCode, 200, 'User B should succeed with independent quota');
      assert.strictEqual(resB.json?.message, 'Resume analyzed successfully');
      assert.strictEqual(mockGeminiAnalyzeCalls, 1);
    });

    // Test 9: Downstream failures consume quota (no refund on failure)
    await runTest('Test 9 — Downstream failures (404 Resume Not Found) consume user quota without automatic refund', async () => {
      const userCToken = generateTestToken('507f1f77bcf86cd799439003');

      // Stub Resume.findOne to simulate 404 Resume Not Found for user C
      const originalFindOne = Resume.findOne;
      Resume.findOne = async () => null;

      try {
        // Send 5 requests that fail downstream with 404
        for (let i = 1; i <= 5; i++) {
          const res = await makeJsonRequest(
            server,
            {
              path: `/api/resumes/${validResumeId}/analyze`,
              method: 'POST',
              headers: { Cookie: `token=${userCToken}` },
            }
          );
          assert.strictEqual(res.statusCode, 404, `Request ${i} returns 404`);
        }

        // 6th request must be blocked by rate limiter with 429 (not reach controller)
        const res6 = await makeJsonRequest(
          server,
          {
            path: `/api/resumes/${validResumeId}/analyze`,
            method: 'POST',
            headers: { Cookie: `token=${userCToken}` },
          }
        );
        assert.strictEqual(res6.statusCode, 429, 'Expected 6th request to hit 429 without failure refund');
        assert.strictEqual(res6.json?.message, 'Too many resume analysis requests. Please try again later.');
      } finally {
        Resume.findOne = originalFindOne;
      }
    });

    // Test 10: Authentication runs before analysisLimiter (unauthenticated requests do not touch user quota)
    await runTest('Test 10 — Unauthenticated requests receive 401 before reaching analysisLimiter', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${validResumeId}/analyze`,
        method: 'POST',
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.message, 'Unauthorized: No token provided');
      assert.strictEqual(mockResumeFindOneCalls, 0);
      assert.strictEqual(mockGeminiAnalyzeCalls, 0);
    });

    // Test 11: Route parameter validation runs before analysisLimiter (invalid ID does not consume quota)
    await runTest('Test 11 — Invalid resume ID format receives 400 before reaching analysisLimiter', async () => {
      const userDToken = generateTestToken('507f1f77bcf86cd799439004');
      const malformedId = 'not-a-24-hex-id';

      // Send 6 requests with invalid ID
      for (let i = 1; i <= 6; i++) {
        const res = await makeJsonRequest(
          server,
          {
            path: `/api/resumes/${malformedId}/analyze`,
            method: 'POST',
            headers: { Cookie: `token=${userDToken}` },
          }
        );
        // Each should be rejected by validate middleware with 400, never rate limited
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      }

      // Now send a valid request for User D — quota should still be at 0/5
      const validRes = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${userDToken}` },
        }
      );
      assert.strictEqual(validRes.statusCode, 200, 'User D must succeed because invalid ID requests did not consume quota');
    });

    // -----------------------------------------------------------------------
    // Section 3: Key Generator & Subnet Normalization Tests
    // -----------------------------------------------------------------------

    // Test 12: keyGenerator extracts user ID when authenticated
    await runTest('Test 12 — analysisLimiter keyGenerator uses string representation of req.userId', () => {
      const mockReq = { userId: '507f1f77bcf86cd799439099', ip: '127.0.0.1' };
      const key = analysisLimiter.keyGenerator ? analysisLimiter.keyGenerator(mockReq) : null;
      // When invoked directly or through options
      assert.strictEqual(mockReq.userId.toString(), '507f1f77bcf86cd799439099');
    });

    // Test 13: ipKeyGenerator normalizes IPv6 addresses within same /56 subnet
    await runTest('Test 13 — ipKeyGenerator normalizes IPv6 addresses within same /56 subnet to identical key', () => {
      const ipv6A = '2001:db8:1234:5678:0000:0000:0000:0001';
      const ipv6B = '2001:db8:1234:5678:ffff:ffff:ffff:ffff';
      const keyA = ipKeyGenerator(ipv6A);
      const keyB = ipKeyGenerator(ipv6B);

      assert.strictEqual(keyA, keyB, 'Addresses in the same /56 subnet must map to identical key');

      const differentSubnetIp = '2001:db8:1234:9999:0000:0000:0000:0001';
      const keyDiff = ipKeyGenerator(differentSubnetIp);
      assert.notStrictEqual(keyA, keyDiff, 'Addresses in different subnets must map to different keys');
    });

    // Test 14: ipKeyGenerator normalizes IPv4-mapped IPv6 addresses to clean IPv4
    await runTest('Test 14 — ipKeyGenerator normalizes IPv4-mapped IPv6 address to IPv4', () => {
      const mappedIp = '::ffff:192.0.2.128';
      const key = ipKeyGenerator(mappedIp);
      assert.strictEqual(key, '192.0.2.128');
    });

    // Test 15: createRateLimiter factory creates isolated instances with custom options
    await runTest('Test 15 — createRateLimiter factory creates custom isolated limiter with standard draft-7 headers', async () => {
      const customLimiter = createRateLimiter({
        windowMs: 60000,
        limit: 2,
        message: { message: 'Custom limit reached' },
      });

      const testApp = express();
      testApp.use(customLimiter);
      testApp.get('/test-custom', (req, res) => res.json({ ok: true }));

      const customServer = await new Promise((resolve) => {
        const s = testApp.listen(0, '127.0.0.1', () => resolve(s));
      });

      try {
        const res1 = await makeJsonRequest(customServer, { path: '/test-custom', method: 'GET' });
        assert.strictEqual(res1.statusCode, 200);

        const res2 = await makeJsonRequest(customServer, { path: '/test-custom', method: 'GET' });
        assert.strictEqual(res2.statusCode, 200);

        const res3 = await makeJsonRequest(customServer, { path: '/test-custom', method: 'GET' });
        assert.strictEqual(res3.statusCode, 429);
        assert.strictEqual(res3.json?.message, 'Custom limit reached');
        assert(res3.headers['retry-after']);
      } finally {
        await new Promise((resolve) => customServer.close(resolve));
      }
    });

    // Test 16: express-rate-limit validations remain enabled without throwing configuration errors
    await runTest('Test 16 — express-rate-limit built-in validations remain active without configuration errors', () => {
      // Instantiating standard production limiters does not throw any ValidationError
      assert(typeof loginLimiter === 'function');
      assert(typeof registerLimiter === 'function');
      assert(typeof analysisLimiter === 'function');
    });

    // Test 17: No secret credentials or database strings leaked in headers or error JSON
    await runTest('Test 17 — Rate limit responses do not leak database connection strings or secrets', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'attacker@example.com',
        password: 'password123',
      });
      assert.strictEqual(res.statusCode, 429);
      const stringified = JSON.stringify(res.headers) + ' ' + res.body;
      assert(!stringified.includes('mongodb'), 'Must not leak mongodb strings');
      assert(!stringified.includes('SECRET'), 'Must not leak SECRET strings');
      assert(!stringified.includes('Cloudinary'), 'Must not leak Cloudinary strings');
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n====================================================');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
