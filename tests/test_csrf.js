const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

// Ensure isolated test environment configuration
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_csrf_suite_32_characters_minimum_length';
process.env.CLIENT_URL = 'https://resume-analyser-sooty-delta.vercel.app';

// 1. Establish Service and Model Mocks BEFORE requiring routes/controllers
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');
const pdfService = require('../server/services/pdfService');

// Spies and mocks
let mockResumeCreateCalls = 0;
let mockResumeDeleteCalls = 0;

const resetMocks = () => {
  mockResumeCreateCalls = 0;
  mockResumeDeleteCalls = 0;
};

User.findOne = async () => null;
User.create = async (doc) => ({
  _id: '507f1f77bcf86cd799439011',
  name: doc.name,
  email: doc.email,
  createdAt: new Date(),
});

Resume.findOne = async (query) => ({
  _id: query._id || '507f191e810c19729de860ea',
  userId: query.userId,
  companyName: 'Acme Corp',
  jobTitle: 'Software Engineer',
  resumePublicId: 'mock_pub_id',
  feedback: {},
  toObject() {
    return { ...this };
  },
  save: async () => {},
});

Resume.create = async (doc) => {
  mockResumeCreateCalls++;
  return {
    _id: '507f191e810c19729de860ea',
    ...doc,
    toObject() {
      return { ...this };
    },
  };
};

Resume.findOneAndDelete = async (query) => {
  mockResumeDeleteCalls++;
  return {
    _id: query._id,
    userId: query.userId,
    resumePublicId: 'mock_pub_id',
  };
};

Resume.find = () => {
  const list = [];
  list.sort = () => list;
  return list;
};

Resume.deleteMany = async () => ({ deletedCount: 0 });

cloudinaryService.uploadPdfBuffer = async () => ({ public_id: 'mock_cloudinary_public_id' });
cloudinaryService.deletePdfAsset = async () => ({ result: 'ok' });
cloudinaryService.generateSignedUrl = (id) => `https://res.cloudinary.com/signed/${id}.pdf`;
pdfService.extractTextFromPdf = async () => 'Sample resume text';
aiService.analyzeResume = async () => ({
  overallScore: 85,
  ATS: { score: 85, tips: [] },
  toneAndStyle: { score: 85, tips: [] },
  content: { score: 85, tips: [] },
  structure: { score: 85, tips: [] },
  skills: { score: 85, tips: [] },
});

// 2. Import Production CSRF Middleware, Handlers, and Routers
const {
  csrfProtection,
  normalizeOrigin,
  getAllowlist,
} = require('../server/middleware/csrf');
const { errorHandler, notFoundHandler } = require('../server/middleware/errorHandler');
const authRoutes = require('../server/routes/authRoutes');
const resumeRoutes = require('../server/routes/resumeRoutes');

// Helper to generate a valid test JWT
const generateTestToken = (userId = '507f1f77bcf86cd799439011') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
};

// Helper to create an Express test server identical to server.js middleware ordering
const createTestServer = (options = {}) => {
  const app = express();
  const clientUrl = options.clientUrl || process.env.CLIENT_URL || 'https://resume-analyser-sooty-delta.vercel.app';

  app.use(cors({
    origin: clientUrl,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'RateLimit-Policy', 'RateLimit'],
  }));
  app.use(cookieParser());
  app.use(express.json());

  // Mount CSRF protection before routes
  app.use(csrfProtection);

  // Health check route
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is healthy' });
  });

  // Mount routes
  app.use('/api/auth', authRoutes);
  app.use('/api/resumes', resumeRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

// HTTP Request helper
const request = (server, options = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBody: data,
          body: parsed,
        });
      });
    });

    req.on('error', reject);
    if (body !== null && body !== undefined) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
};

// Test Runner State
let passedCount = 0;
let failedCount = 0;

const runTest = async (name, testFn) => {
  try {
    resetMocks();
    await testFn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failedCount++;
  }
};

(async () => {
  console.log('====================================================');
  console.log('Phase 1 Remediation R-1: CSRF Protection Test Suite');
  console.log('====================================================\n');

  const app = createTestServer();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const validToken = generateTestToken();
  const validOrigin = 'https://resume-analyser-sooty-delta.vercel.app';
  const customHeader = { 'X-Requested-With': 'XMLHttpRequest' };

  try {
    // ----------------------------------------------------
    // Section A: Safe Methods & CORS Passthrough
    // ----------------------------------------------------
    await runTest('Test 1 — Safe GET /api/health succeeds (200) without custom header or Origin', async () => {
      const res = await request(server, {
        path: '/api/health',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body?.status, 'ok');
    });

    await runTest('Test 2 — Safe GET /api/auth/me succeeds (200) with cookie and no custom header', async () => {
      User.findById = () => ({
        select: async () => ({
          _id: '507f1f77bcf86cd799439011',
          name: 'Test User',
          email: 'test@example.com',
          createdAt: new Date(),
        }),
      });

      const res = await request(server, {
        path: '/api/auth/me',
        method: 'GET',
        headers: {
          Cookie: `token=${validToken}`,
        },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body?.user?.email, 'test@example.com');
    });

    await runTest('Test 3 — CORS preflight OPTIONS /api/resumes succeeds (204) and includes X-Requested-With', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'OPTIONS',
        headers: {
          Origin: validOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Requested-With',
        },
      });
      assert.strictEqual(res.statusCode, 204);
      assert.strictEqual(res.headers['access-control-allow-origin'], validOrigin);
      const allowHeaders = (res.headers['access-control-allow-headers'] || '').toLowerCase();
      assert.ok(allowHeaders.includes('x-requested-with'), 'Expected X-Requested-With in allowed headers');
    });

    // ----------------------------------------------------
    // Section B: Legitimate Requests with Allowed Origin
    // ----------------------------------------------------
    await runTest('Test 4 — POST /api/auth/login with allowed Origin and X-Requested-With passes CSRF', async () => {
      const res = await request(server, {
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          Origin: validOrigin,
          ...customHeader,
          'Content-Type': 'application/json',
        },
      }, {
        email: 'notfound@example.com',
        password: 'Password123',
      });
      // Should reach controller logic and return 401 (not CSRF 403)
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body?.message, 'Invalid email or password');
    });

    await runTest('Test 5 — POST /api/auth/register with allowed Origin and X-Requested-With passes CSRF', async () => {
      const res = await request(server, {
        path: '/api/auth/register',
        method: 'POST',
        headers: {
          Origin: validOrigin,
          ...customHeader,
          'Content-Type': 'application/json',
        },
      }, {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'ValidPassword123!',
      });
      // Should reach controller and return 201 Created
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body?.message, 'User registered successfully');
    });

    await runTest('Test 6 — POST /api/resumes with allowed Origin and X-Requested-With succeeds', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: validOrigin,
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Acme Corp',
        jobTitle: 'Software Engineer',
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(mockResumeCreateCalls, 1);
    });

    // ----------------------------------------------------
    // Section C: Custom Header Requirements
    // ----------------------------------------------------
    await runTest('Test 7 — POST /api/resumes with allowed Origin but missing X-Requested-With is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: validOrigin,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Forged Corp',
        jobTitle: 'Forged Role',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0, 'Database mutation must not be called');
    });

    await runTest('Test 8 — DELETE /api/resumes/:id with allowed Origin but missing X-Requested-With is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes/507f191e810c19729de860ea',
        method: 'DELETE',
        headers: {
          Origin: validOrigin,
          Cookie: `token=${validToken}`,
        },
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeDeleteCalls, 0, 'Delete mutation must not be called');
    });

    await runTest('Test 9 — POST /api/auth/logout with invalid X-Requested-With value is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/auth/logout',
        method: 'POST',
        headers: {
          Origin: validOrigin,
          'X-Requested-With': 'OtherClient',
        },
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
    });

    // ----------------------------------------------------
    // Section D: Origin Validation & Malformed Origin Attacks
    // ----------------------------------------------------
    await runTest('Test 10 — POST /api/resumes with disallowed Origin is rejected with 403 even with X-Requested-With', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'https://malicious-site.com',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Evil Corp',
        jobTitle: 'Hacker',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 11 — POST /api/resumes with Origin: null is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'null',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Iframe Corp',
        jobTitle: 'Sandboxed',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 12 — POST /api/resumes with malformed Origin string is rejected with 403 without throwing', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'not-a-valid-url-protocol://',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Malformed Corp',
        jobTitle: 'Invalid',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 13 — Subdomain / suffix spoofing attempt is strictly rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'https://resume-analyser-sooty-delta.vercel.app.attacker.com',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Phish Corp',
        jobTitle: 'Phisher',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 14 — Insecure HTTP scheme spoofing is strictly rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'http://resume-analyser-sooty-delta.vercel.app', // HTTP instead of HTTPS
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Insecure Corp',
        jobTitle: 'MITM',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 15 — Port spoofing attempt is strictly rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'https://resume-analyser-sooty-delta.vercel.app:8443',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Port Corp',
        jobTitle: 'Custom Port',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    // ----------------------------------------------------
    // Section E: Referer Fallback & Non-Overriding Semantics
    // ----------------------------------------------------
    await runTest('Test 16 — Missing Origin with valid allowed Referer and custom header succeeds', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Referer: 'https://resume-analyser-sooty-delta.vercel.app/dashboard/upload',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Referer Corp',
        jobTitle: 'Valid Referer',
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(mockResumeCreateCalls, 1);
    });

    await runTest('Test 17 — Missing Origin with mismatched Referer is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Referer: 'https://evil-phishing.com/page.html',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Bad Referer Corp',
        jobTitle: 'Bad Referer',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 18 — Missing Origin with malformed Referer string is rejected with 403', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Referer: 'not-a-valid-referer-url',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Corrupt Referer Corp',
        jobTitle: 'Corrupt Referer',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 19 — Disallowed Origin with legitimate Referer is strictly rejected with 403 (Referer does NOT override bad Origin)', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'https://malicious-site.com',
          Referer: 'https://resume-analyser-sooty-delta.vercel.app/dashboard',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Spoof Corp',
        jobTitle: 'Spoofed Referer',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body?.message, 'CSRF validation failed');
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    // ----------------------------------------------------
    // Section F: Production vs Development Environment Rules
    // ----------------------------------------------------
    await runTest('Test 20 — Missing Origin AND missing Referer with custom header in production mode is rejected with 403', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await request(server, {
          path: '/api/resumes',
          method: 'POST',
          headers: {
            ...customHeader,
            Cookie: `token=${validToken}`,
            'Content-Type': 'application/json',
          },
        }, {
          companyName: 'Missing Headers Corp',
          jobTitle: 'Prod Missing',
        });
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(res.body?.message, 'CSRF validation failed');
        assert.strictEqual(mockResumeCreateCalls, 0);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    await runTest('Test 21 — Missing Origin AND missing Referer with custom header in explicit test/development mode is accepted', async () => {
      // process.env.NODE_ENV is 'test'
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Dev Tool Corp',
        jobTitle: 'CLI Tool',
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(mockResumeCreateCalls, 1);
    });

    // ----------------------------------------------------
    // Section G: Response Sanitization & Real Log Emission Inspection
    // ----------------------------------------------------
    await runTest('Test 22 — 403 response payload format strictly conforms to sanitized contract', async () => {
      const res = await request(server, {
        path: '/api/resumes',
        method: 'POST',
        headers: {
          Origin: 'https://unauthorized-origin.com',
          ...customHeader,
          Cookie: `token=${validToken}`,
          'Content-Type': 'application/json',
        },
      }, {
        companyName: 'Forbidden Corp',
        jobTitle: 'Forbidden',
      });
      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.body, { message: 'CSRF validation failed' });
      assert.strictEqual(res.rawBody.includes('stack'), false, 'Response must not contain stack trace');
      assert.strictEqual(res.rawBody.includes('unauthorized-origin.com'), false, 'Response must not reflect untrusted origin');
    });

    await runTest('Test 23 — Log sanitization verifies emitted logs capture no cookies, JWT tokens, or request bodies', async () => {
      const interceptedLogs = [];
      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      const originalConsoleLog = console.log;

      console.error = (...args) => {
        interceptedLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
        originalConsoleError.apply(console, args);
      };
      console.warn = (...args) => {
        interceptedLogs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
        originalConsoleWarn.apply(console, args);
      };
      console.log = (...args) => {
        // preserve test log output
        originalConsoleLog.apply(console, args);
      };

      const sensitivePayload = {
        companyName: 'CLASSIFIED_COMPANY_SECRET_STRING',
        jobTitle: 'TOP_SECRET_EXECUTIVE',
        jobDescription: 'PRIVATE_SENSITIVE_RESUME_DETAILS_NEVER_LOG',
      };
      const sensitiveToken = 'SENSITIVE_SECRET_BEARER_TOKEN_VALUE_XYZ';

      try {
        const res = await request(server, {
          path: '/api/resumes',
          method: 'POST',
          headers: {
            Origin: 'https://evil-hacker.com',
            ...customHeader,
            Cookie: `token=${sensitiveToken}`,
            'Content-Type': 'application/json',
          },
        }, sensitivePayload);

        assert.strictEqual(res.statusCode, 403);

        const joinedLogs = interceptedLogs.join('\n');

        // Verify that NO sensitive cookies, tokens, or body details were emitted into server logs
        assert.strictEqual(joinedLogs.includes(sensitiveToken), false, 'Emitted logs must NOT contain JWT token');
        assert.strictEqual(joinedLogs.includes('token='), false, 'Emitted logs must NOT contain cookie token prefix');
        assert.strictEqual(joinedLogs.includes('CLASSIFIED_COMPANY_SECRET_STRING'), false, 'Emitted logs must NOT contain company name');
        assert.strictEqual(joinedLogs.includes('TOP_SECRET_EXECUTIVE'), false, 'Emitted logs must NOT contain job title');
        assert.strictEqual(joinedLogs.includes('PRIVATE_SENSITIVE_RESUME_DETAILS_NEVER_LOG'), false, 'Emitted logs must NOT contain job description');

        // Confirm standard sanitized message was emitted
        assert.ok(
          joinedLogs.includes('[Client Error] POST /api/resumes -> 403: CSRF validation failed'),
          'Expected standard sanitized client error log entry'
        );
      } finally {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
        console.log = originalConsoleLog;
      }
    });

  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`CSRF Protection Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
})();
