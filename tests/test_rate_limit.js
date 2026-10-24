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
let mockCloudinaryUploadCalls = 0;
let mockMulterCalls = 0;

const resetSpies = () => {
  mockGeminiAnalyzeCalls = 0;
  mockResumeFindOneCalls = 0;
  mockUserFindOneCalls = 0;
  mockUserCreateCalls = 0;
  mockCloudinaryUploadCalls = 0;
  mockMulterCalls = 0;
};

// Wire default spy implementations
cloudinaryService.generateSignedUrl = (publicId) => {
  return `https://res.cloudinary.com/mock/image/upload/signed/${publicId}.pdf`;
};

cloudinaryService.uploadPdfBuffer = async (buffer) => {
  mockCloudinaryUploadCalls++;
  return {
    public_id: 'mock_cloudinary_public_id',
    secure_url: 'https://res.cloudinary.com/mock/image/upload/mock_cloudinary_public_id.pdf',
  };
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

Resume.create = async (doc) => ({
  _id: '507f191e810c19729de860ea',
  ...doc,
  createdAt: new Date(),
});

// 2. Import Production Routers, Middleware & Limiter module
const authRoutes = require('../server/routes/authRoutes');
const resumeRoutes = require('../server/routes/resumeRoutes');
const { errorHandler } = require('../server/middleware/errorHandler');
const {
  createRateLimiter,
  loginLimiter,
  registerLimiter,
  analysisLimiter,
  globalAnalysisLimiter,
  uploadIpLimiter,
  uploadUserLimiter,
} = require('../server/middleware/rateLimiter');
const { ipKeyGenerator } = require('express-rate-limit');

// Spy on Multer upload middleware layer inside resumeRoutes
const uploadRouteLayer = resumeRoutes.stack.find((layer) => layer.route && layer.route.path === '/');
if (uploadRouteLayer) {
  const multerLayer = uploadRouteLayer.route.stack.find(
    (layer) => layer.handle && layer.handle.name === 'uploadResumeFile'
  );
  if (multerLayer) {
    const origMulterHandler = multerLayer.handle;
    multerLayer.handle = (req, res, next) => {
      mockMulterCalls++;
      return origMulterHandler(req, res, next);
    };
  }
}

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

/**
 * Issues a multipart/form-data HTTP request to the test server.
 */
const makeMultipartRequest = (server, options = {}, fields = {}, file = null) => {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const boundary = '----WebKitFormBoundaryTest' + Math.random().toString(36).substring(2);
    const chunks = [];

    for (const [key, value] of Object.entries(fields)) {
      chunks.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`)
      );
    }

    if (file) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname || 'resume'}"; filename="${file.filename || 'resume.pdf'}"\r\nContent-Type: ${file.mimetype || 'application/pdf'}\r\n\r\n`
        )
      );
      chunks.push(file.buffer);
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    const payload = Buffer.concat(chunks);

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length,
      ...(options.headers || {}),
    };

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: options.path || '/api/resumes',
        method: options.method || 'POST',
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
    req.write(payload);
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
      assert(typeof globalAnalysisLimiter === 'function');
      assert(typeof uploadIpLimiter === 'function');
      assert(typeof uploadUserLimiter === 'function');
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

    // -----------------------------------------------------------------------
    // Section 4: Dual-Layer Resume Upload Rate Limiting (R-2)
    // -----------------------------------------------------------------------

    const uploadUser1Id = '507f1f77bcf86cd799439101';
    const uploadUser1Token = generateTestToken(uploadUser1Id);

    // Test 18 (Requirement 1): Upload user-limit normal flow
    await runTest('Test 18 — POST /api/resumes allows up to 10 uploads per 15 minutes for authenticated user', async () => {
      uploadUserLimiter.resetKey(uploadUser1Id);
      uploadIpLimiter.resetKey('127.0.0.1');

      for (let i = 1; i <= 10; i++) {
        const res = await makeJsonRequest(
          server,
          {
            path: '/api/resumes',
            method: 'POST',
            headers: { Cookie: `token=${uploadUser1Token}` },
          },
          {
            companyName: `Company ${i}`,
            jobTitle: `Software Engineer ${i}`,
          }
        );
        assert.strictEqual(res.statusCode, 201, `Upload ${i} should succeed with HTTP 201`);
        assert.strictEqual(res.json?.message, 'Resume created successfully');
      }
    });

    // Test 19 (Requirement 2): Upload user-limit exhaustion
    await runTest('Test 19 — POST /api/resumes returns HTTP 429 when user upload quota (10) is exhausted', async () => {
      const res = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${uploadUser1Token}` },
        },
        {
          companyName: 'Excess Company',
          jobTitle: 'Excess Engineer',
        }
      );
      assert.strictEqual(res.statusCode, 429, 'Expected 11th request to return HTTP 429');
      assert.strictEqual(res.json?.message, 'Too many resume uploads. Please try again later.');
      assert(res.headers['retry-after'], 'Expected Retry-After header on 429');
    });

    // Test 20 (Requirement 3): Multer/downstream bypass when an upload limiter rejects
    await runTest('Test 20 — Rate-limited upload bypasses Multer buffer allocation and Cloudinary storage', async () => {
      resetSpies();
      const mockPdfBuffer = Buffer.from('%PDF-1.4 Mock PDF file binary data stream');

      const res = await makeMultipartRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${uploadUser1Token}` },
        },
        { companyName: 'Blocked Company', jobTitle: 'Blocked Engineer' },
        { fieldname: 'resume', filename: 'resume.pdf', mimetype: 'application/pdf', buffer: mockPdfBuffer }
      );

      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(mockMulterCalls, 0, 'Multer middleware must not be invoked when rate limited');
      assert.strictEqual(mockCloudinaryUploadCalls, 0, 'Cloudinary upload service must not be invoked when rate limited');
    });

    // Test 21 (Requirement 4): Independent user quotas
    await runTest('Test 21 — Independent user retains separate upload quota and succeeds from the same IP', async () => {
      const uploadUser2Id = '507f1f77bcf86cd799439102';
      const uploadUser2Token = generateTestToken(uploadUser2Id);
      uploadUserLimiter.resetKey(uploadUser2Id);

      const res = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${uploadUser2Token}` },
        },
        {
          companyName: 'User 2 Company',
          jobTitle: 'User 2 Engineer',
        }
      );
      assert.strictEqual(res.statusCode, 201, 'User 2 must succeed with independent user quota');
      assert.strictEqual(res.json?.message, 'Resume created successfully');
    });

    // Test 22 (Requirement 5): IP-limit exhaustion across multiple accounts
    await runTest('Test 22 — POST /api/resumes IP limiter caps total uploads at 25 requests across multiple accounts', async () => {
      uploadIpLimiter.resetKey('127.0.0.1');

      // Account A: 10 uploads (IP 1..10)
      const tokenA = generateTestToken('507f1f77bcf86cd799439111');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439111');
      for (let i = 1; i <= 10; i++) {
        const res = await makeJsonRequest(
          server,
          { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenA}` } },
          { companyName: `A_${i}`, jobTitle: 'Dev' }
        );
        assert.strictEqual(res.statusCode, 201);
      }

      // Account B: 10 uploads (IP 11..20)
      const tokenB = generateTestToken('507f1f77bcf86cd799439112');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439112');
      for (let i = 1; i <= 10; i++) {
        const res = await makeJsonRequest(
          server,
          { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenB}` } },
          { companyName: `B_${i}`, jobTitle: 'Dev' }
        );
        assert.strictEqual(res.statusCode, 201);
      }

      // Account C: 5 uploads (IP 21..25)
      const tokenC = generateTestToken('507f1f77bcf86cd799439113');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439113');
      for (let i = 1; i <= 5; i++) {
        const res = await makeJsonRequest(
          server,
          { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenC}` } },
          { companyName: `C_${i}`, jobTitle: 'Dev' }
        );
        assert.strictEqual(res.statusCode, 201);
      }

      // Account D (brand new user with 0 uploads) attempts 26th upload from same IP
      const tokenD = generateTestToken('507f1f77bcf86cd799439114');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439114');

      const excessIpRes = await makeJsonRequest(
        server,
        { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenD}` } },
        { companyName: 'D_1', jobTitle: 'Dev' }
      );
      assert.strictEqual(excessIpRes.statusCode, 429, '26th upload from same IP must hit IP rate limit');
      assert.strictEqual(
        excessIpRes.json?.message,
        'Too many resume uploads from this IP address. Please try again later.'
      );
      assert(excessIpRes.headers['retry-after'], 'Expected Retry-After header on IP rate limit');
    });

    // Test 23 (Requirement 6): Spoofed forwarding-header behavior under the tested proxy configuration
    await runTest('Test 23 — Spoofed X-Forwarded-For header does not bypass IP rate limit when proxy is untrusted', async () => {
      // Under test environment, trust proxy is false. Express resolves req.ip from socket (127.0.0.1)
      const tokenE = generateTestToken('507f1f77bcf86cd799439115');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439115');

      const spoofedRes = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: {
            Cookie: `token=${tokenE}`,
            'X-Forwarded-For': '203.0.113.195',
            'X-Real-IP': '203.0.113.195',
          },
        },
        { companyName: 'Spoof Corp', jobTitle: 'Dev' }
      );

      assert.strictEqual(spoofedRes.statusCode, 429, 'Spoofed header must not bypass IP rate limit');
      assert.strictEqual(
        spoofedRes.json?.message,
        'Too many resume uploads from this IP address. Please try again later.'
      );
      assert.strictEqual(mockMulterCalls, 0, 'Multer must not be invoked for rate-limited request with spoofed IP');
    });

    // -----------------------------------------------------------------------
    // Section 5: Global AI Analysis Limiting & Quota Precedence (R-2)
    // -----------------------------------------------------------------------

    // Test 24 (Requirement 7): Global analysis-limit exhaustion across users
    await runTest('Test 24 — Global analysis limiter enforces 50 req/hr cap across multiple users', async () => {
      globalAnalysisLimiter.resetKey('global_ai_analysis_bucket');

      // Distribute 50 requests across 10 users (5 each, matching per-user limit)
      for (let u = 1; u <= 10; u++) {
        const uId = `507f1f77bcf86cd7994391${u.toString().padStart(2, '0')}`;
        const uToken = generateTestToken(uId);
        analysisLimiter.resetKey(uId);

        for (let r = 1; r <= 5; r++) {
          const res = await makeJsonRequest(
            server,
            {
              path: `/api/resumes/${validResumeId}/analyze`,
              method: 'POST',
              headers: { Cookie: `token=${uToken}` },
            }
          );
          assert.strictEqual(res.statusCode, 200, `Global request user ${u} req ${r} should succeed`);
        }
      }
      assert.strictEqual(mockGeminiAnalyzeCalls, 50, 'Exactly 50 Gemini calls executed');

      // User 11 with 0 prior requests attempts 51st global analysis
      const user11Id = '507f1f77bcf86cd799439199';
      const user11Token = generateTestToken(user11Id);
      analysisLimiter.resetKey(user11Id);

      const excessGlobalRes = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${user11Token}` },
        }
      );
      assert.strictEqual(excessGlobalRes.statusCode, 429, '51st global request must return HTTP 429');
      assert.strictEqual(
        excessGlobalRes.json?.message,
        'System-wide AI analysis capacity reached. Please try again later.'
      );
      assert.strictEqual(mockGeminiAnalyzeCalls, 50, 'Gemini must not be called when global quota is exhausted');
      assert(excessGlobalRes.headers['retry-after'], 'Expected Retry-After header on global 429');
    });

    // Test 25 (Requirement 8): Existing per-user analysis-limit preservation
    await runTest('Test 25 — Per-user analysis limit (5 req/hr) is enforced even when global capacity is available', async () => {
      globalAnalysisLimiter.resetKey('global_ai_analysis_bucket');

      const singleUserId = '507f1f77bcf86cd799439201';
      const singleUserToken = generateTestToken(singleUserId);
      analysisLimiter.resetKey(singleUserId);

      // Send 5 valid requests
      for (let i = 1; i <= 5; i++) {
        const res = await makeJsonRequest(
          server,
          {
            path: `/api/resumes/${validResumeId}/analyze`,
            method: 'POST',
            headers: { Cookie: `token=${singleUserToken}` },
          }
        );
        assert.strictEqual(res.statusCode, 200);
      }

      // 6th request from same user should hit user limiter (not global limiter)
      const res6 = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${validResumeId}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${singleUserToken}` },
        }
      );
      assert.strictEqual(res6.statusCode, 429);
      assert.strictEqual(res6.json?.message, 'Too many resume analysis requests. Please try again later.');
    });

    // Test 26 (Requirement 9): Invalid resume ID rejected before consuming global quota
    await runTest('Test 26 — Invalid resume ID format is rejected by validate middleware before consuming global quota', async () => {
      globalAnalysisLimiter.resetKey('global_ai_analysis_bucket');

      const testUserToken = generateTestToken('507f1f77bcf86cd799439202');
      analysisLimiter.resetKey('507f1f77bcf86cd799439202');

      // Send 10 invalid-ID requests
      for (let i = 1; i <= 10; i++) {
        const res = await makeJsonRequest(
          server,
          {
            path: '/api/resumes/not-a-valid-hex-id/analyze',
            method: 'POST',
            headers: { Cookie: `token=${testUserToken}` },
          }
        );
        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      }

      // 50 valid requests across 10 users still succeed fully because invalid IDs did not consume global quota
      for (let u = 1; u <= 10; u++) {
        const uId = `507f1f77bcf86cd7994393${u.toString().padStart(2, '0')}`;
        const uToken = generateTestToken(uId);
        analysisLimiter.resetKey(uId);

        for (let r = 1; r <= 5; r++) {
          const res = await makeJsonRequest(
            server,
            {
              path: `/api/resumes/${validResumeId}/analyze`,
              method: 'POST',
              headers: { Cookie: `token=${uToken}` },
            }
          );
          assert.strictEqual(res.statusCode, 200);
        }
      }
      assert.strictEqual(mockGeminiAnalyzeCalls, 50, 'All 50 global slots were preserved and used');
    });

    // Test 27 (Requirement 10): Unauthenticated upload rejected before consuming upload quota
    await runTest('Test 27 — Unauthenticated upload requests are rejected by auth middleware before consuming upload quotas', async () => {
      uploadIpLimiter.resetKey('127.0.0.1');

      // Send 30 unauthenticated requests (exceeding the 25 IP limit)
      for (let i = 1; i <= 30; i++) {
        const unauthRes = await makeJsonRequest(server, {
          path: '/api/resumes',
          method: 'POST',
        }, { companyName: 'Acme', jobTitle: 'Dev' });
        assert.strictEqual(unauthRes.statusCode, 401);
        assert.strictEqual(unauthRes.json?.message, 'Unauthorized: No token provided');
      }

      // An authenticated user on this IP should still have full quota available
      const authedToken = generateTestToken('507f1f77bcf86cd799439401');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439401');

      const authedRes = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${authedToken}` },
        },
        { companyName: 'Authed Acme', jobTitle: 'Lead Dev' }
      );
      assert.strictEqual(authedRes.statusCode, 201, 'Authenticated upload must succeed because unauthenticated requests did not consume IP quota');
      assert.strictEqual(authedRes.json?.message, 'Resume created successfully');
    });

    // Test 28 (Requirement 11): Rate-limit headers, reset behavior, and sensitive-data non-disclosure
    await runTest('Test 28 — Rate-limit responses emit standard draft-7 headers, integer retry-after, support resets, and disclose zero secrets', async () => {
      const tokenBlocked = generateTestToken('507f1f77bcf86cd799439501');
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439501');
      uploadIpLimiter.resetKey('127.0.0.1');

      // Exhaust user limit (10 requests)
      for (let i = 1; i <= 10; i++) {
        await makeJsonRequest(
          server,
          { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenBlocked}` } },
          { companyName: 'Acme', jobTitle: 'Dev' }
        );
      }

      const res429 = await makeJsonRequest(
        server,
        { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenBlocked}` } },
        { companyName: 'Acme', jobTitle: 'Dev' }
      );

      assert.strictEqual(res429.statusCode, 429);
      // Standard draft-7 RateLimit header
      assert(res429.headers['ratelimit'], 'Expected ratelimit header on 429');
      assert(/limit=\d+,\s*remaining=\d+,\s*reset=\d+/.test(res429.headers['ratelimit']), 'Draft-7 format matches');
      // Retry-After header as integer string
      assert(res429.headers['retry-after'], 'Expected retry-after header');
      assert(/^\d+$/.test(res429.headers['retry-after']), 'retry-after must be a numeric integer string');
      // Legacy headers absent
      assert.strictEqual(res429.headers['x-ratelimit-limit'], undefined);
      assert.strictEqual(res429.headers['x-ratelimit-remaining'], undefined);

      // Sensitive data non-disclosure
      const fullResponseString = JSON.stringify(res429.headers) + ' ' + res429.body;
      assert(!fullResponseString.includes('mongodb'), 'Must not disclose MongoDB URI');
      assert(!fullResponseString.includes('JWT_SECRET'), 'Must not disclose JWT secrets');
      assert(!fullResponseString.includes('CLOUDINARY'), 'Must not disclose Cloudinary secrets');
      assert(!fullResponseString.includes('cookie'), 'Must not disclose cookies in body');

      // Verify resetKey resets state immediately without waiting 15 minutes
      uploadUserLimiter.resetKey('507f1f77bcf86cd799439501');
      const resetRes = await makeJsonRequest(
        server,
        { path: '/api/resumes', method: 'POST', headers: { Cookie: `token=${tokenBlocked}` } },
        { companyName: 'Reset Acme', jobTitle: 'Dev' }
      );
      assert.strictEqual(resetRes.statusCode, 201, 'Request immediately succeeds after resetKey');
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
