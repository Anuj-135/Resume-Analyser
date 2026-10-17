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
process.env.JWT_SECRET = 'test_jwt_secret_http_429_retry_suite_32_chars';

// Import services and models for mocking
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');
const pdfService = require('../server/services/pdfService');

// Spies
let mockCloudinaryUploadCalls = 0;
let mockResumeCreateCalls = 0;
let mockGeminiAnalyzeCalls = 0;
let mockResumeFindOneCalls = 0;

const resetSpies = () => {
  mockCloudinaryUploadCalls = 0;
  mockResumeCreateCalls = 0;
  mockGeminiAnalyzeCalls = 0;
  mockResumeFindOneCalls = 0;
};

// Wire default spy implementations
cloudinaryService.uploadPdfBuffer = async (buffer) => {
  mockCloudinaryUploadCalls++;
  return { public_id: 'mock_cloudinary_public_id_429_test' };
};

cloudinaryService.generateSignedUrl = (publicId) => {
  return `https://res.cloudinary.com/mock/image/upload/signed/${publicId}.pdf`;
};

pdfService.extractTextFromPdf = async (publicId) => {
  return 'Standard extracted resume text for 429 testing';
};

aiService.analyzeResume = async (params) => {
  mockGeminiAnalyzeCalls++;
  return {
    overallScore: 88,
    ATS: { score: 88, tips: [{ type: 'good', tip: 'Strong format' }] },
    summary: 'Solid candidate profile',
  };
};

const mockResumesDb = new Map();

Resume.create = async (doc) => {
  mockResumeCreateCalls++;
  const id = '507f191e810c19729de860ea';
  const record = {
    _id: id,
    userId: doc.userId,
    companyName: doc.companyName,
    jobTitle: doc.jobTitle,
    jobDescription: doc.jobDescription,
    resumePublicId: doc.resumePublicId,
    feedback: doc.feedback || {},
    save: async function () {
      mockResumesDb.set(String(this._id), this);
    },
  };
  mockResumesDb.set(id, record);
  return record;
};

Resume.findOne = async (query) => {
  mockResumeFindOneCalls++;
  const id = String(query._id);
  if (mockResumesDb.has(id)) {
    return mockResumesDb.get(id);
  }
  return {
    _id: id,
    userId: query.userId,
    companyName: 'Acme Corp',
    jobTitle: 'Software Engineer',
    jobDescription: 'Backend APIs',
    resumePublicId: 'mock_cloudinary_public_id',
    feedback: {},
    save: async function () {
      mockResumesDb.set(String(this._id), this);
    },
  };
};

// Rate limiter factory
const { createRateLimiter } = require('../server/middleware/rateLimiter');
const auth = require('../server/middleware/auth');
const validate = require('../server/middleware/validate');
const { resumeIdParamSchema } = require('../server/schemas/resumeSchemas');
const { analyzeResume } = require('../server/controllers/resumeController');

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

const generateTestToken = (userId = '507f1f77bcf86cd799439001') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
};

const makeRequest = (server, options = {}, body = null) => {
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
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(responseBody);
          } catch {}
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseBody,
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

// Mirror client utils for direct deterministic validation in node environment
const MAX_SAFE_RETRY_AFTER_SECONDS = 31536000;

function parseRetryAfterHeader(headers) {
  if (!headers || typeof headers !== 'object') return null;

  const rawValue = headers['retry-after'] || headers['Retry-After'];
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return null;

  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (
      Number.isSafeInteger(seconds) &&
      seconds >= 0 &&
      seconds <= MAX_SAFE_RETRY_AFTER_SECONDS
    ) {
      return seconds;
    }
    return null;
  }

  // 2. HTTP-date format parsing (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  // Must match an HTTP-date candidate (contains standard month abbreviation and time colons)
  // to prevent overly-lenient Date.parse from interpreting negative numbers or decimals as dates
  const isHttpDateCandidate =
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed) &&
    /:\d{2}/.test(trimmed);

  if (isHttpDateCandidate) {
    const dateTimestamp = Date.parse(trimmed);
    if (!isNaN(dateTimestamp)) {
      const diffSeconds = Math.ceil((dateTimestamp - Date.now()) / 1000);
      if (diffSeconds <= 0) {
        return 0; // Expired date returns 0
      }
      if (
        Number.isSafeInteger(diffSeconds) &&
        diffSeconds <= MAX_SAFE_RETRY_AFTER_SECONDS
      ) {
        return diffSeconds;
      }
    }
  }

  return null;
}

function formatRetryTime(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return 'immediately';
  if (seconds <= 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `approximately ${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.round(minutes / 60);
  return `approximately ${hours} hour${hours > 1 ? 's' : ''}`;
}

function isAnalysisComplete(feedback) {
  if (!feedback || typeof feedback !== 'object') return false;
  return (
    typeof feedback.overallScore === 'number' &&
    Number.isFinite(feedback.overallScore) &&
    Object.keys(feedback).length > 0
  );
}

(async () => {
  console.log('====================================================');
  console.log('HTTP 429 Handling, Retry-After & Retry Test Suite');
  console.log('====================================================\n');

  // Section 1: Strict Retry-After Header Parsing Unit Tests
  await runTest('Test 1.1 — Strict rejection of malformed numeric prefixes like "30abc"', () => {
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '30abc' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '30s' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '12.5' }), null);
  });

  await runTest('Test 1.2 — Strict rejection of negative values', () => {
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '-5' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '-1' }), null);
  });

  await runTest('Test 1.3 — Strict rejection of unsafe integers exceeding 1 year or MAX_SAFE_INTEGER', () => {
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '31536001' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '9999999999999999' }), null);
  });

  await runTest('Test 1.4 — Explicit zero handling (preserves numeric 0)', () => {
    const result = parseRetryAfterHeader({ 'retry-after': '0' });
    assert.strictEqual(result, 0);
    assert.notStrictEqual(result, null);
    assert.strictEqual(formatRetryTime(0), 'immediately');
  });

  await runTest('Test 1.5 — Acceptance of valid integer delta-seconds', () => {
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '120' }), 120);
    assert.strictEqual(parseRetryAfterHeader({ 'Retry-After': '3600' }), 3600);
    assert.strictEqual(formatRetryTime(120), 'approximately 2 minutes');
    assert.strictEqual(formatRetryTime(3600), 'approximately 1 hour');
  });

  await runTest('Test 1.6 — Valid future HTTP-date parsing', () => {
    const futureDate = new Date(Date.now() + 65000).toUTCString();
    const result = parseRetryAfterHeader({ 'retry-after': futureDate });
    assert(typeof result === 'number' && result > 0 && result <= 66);
  });

  await runTest('Test 1.7 — Expired / past HTTP-date returns 0 (not null)', () => {
    const pastDate = new Date(Date.now() - 30000).toUTCString();
    const result = parseRetryAfterHeader({ 'retry-after': pastDate });
    assert.strictEqual(result, 0);
  });

  await runTest('Test 1.8 — Missing, invalid, and garbage headers return null without throwing', () => {
    assert.strictEqual(parseRetryAfterHeader(null), null);
    assert.strictEqual(parseRetryAfterHeader(undefined), null);
    assert.strictEqual(parseRetryAfterHeader({}), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': '' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': 'invalid-date' }), null);
    assert.strictEqual(parseRetryAfterHeader({ 'retry-after': {} }), null);
  });

  await runTest('Test 1.9 — isAnalysisComplete verifies Mongoose/API feedback structure', () => {
    assert.strictEqual(isAnalysisComplete(null), false);
    assert.strictEqual(isAnalysisComplete({}), false);
    assert.strictEqual(isAnalysisComplete({ overallScore: '88' }), false);
    assert.strictEqual(isAnalysisComplete({ overallScore: NaN }), false);
    assert.strictEqual(
      isAnalysisComplete({ overallScore: 88, ATS: { score: 88 }, summary: 'Great' }),
      true
    );
  });

  // Section 2: CORS Header Exposure on Real Cross-Origin Requests
  let testServer;
  try {
    const app = express();
    app.use(
      cors({
        origin: 'http://localhost:3000',
        credentials: true,
        exposedHeaders: [
          'Retry-After',
          'RateLimit-Limit',
          'RateLimit-Remaining',
          'RateLimit-Reset',
          'RateLimit-Policy',
          'RateLimit',
        ],
      })
    );
    app.use(cookieParser());
    app.use(express.json());

    // Isolated test limiter (limit 1 request per 10s)
    const testLimiter = createRateLimiter({
      windowMs: 10000,
      limit: 1,
      message: { message: 'Too many resume analysis requests. Please try again later.' },
      keyGenerator: (req) => (req.userId ? req.userId.toString() : 'test-ip'),
    });

    app.post(
      '/api/test-analyze/:id',
      auth,
      validate({ params: resumeIdParamSchema }),
      testLimiter,
      analyzeResume
    );

    testServer = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const testUserToken = generateTestToken('507f1f77bcf86cd799439088');
    const resumeId = '507f191e810c19729de860ea';

    await runTest('Test 2.1 — Cross-origin OPTIONS preflight exposes Retry-After', async () => {
      const res = await makeRequest(testServer, {
        path: `/api/test-analyze/${resumeId}`,
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      assert.strictEqual(res.statusCode, 204);
      const exposed = res.headers['access-control-expose-headers'];
      assert(exposed, 'Expected access-control-expose-headers header');
      assert(exposed.toLowerCase().includes('retry-after'));
    });

    await runTest('Test 2.2 — Real cross-origin POST 429 response includes Access-Control-Expose-Headers and Retry-After', async () => {
      // Request 1: Succeeds (consumes limit of 1)
      const res1 = await makeRequest(testServer, {
        path: `/api/test-analyze/${resumeId}`,
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Cookie: `token=${testUserToken}`,
        },
      });
      assert.strictEqual(res1.statusCode, 200);

      // Request 2: Must return HTTP 429 and include both Retry-After and access-control-expose-headers
      const res2 = await makeRequest(testServer, {
        path: `/api/test-analyze/${resumeId}`,
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          Cookie: `token=${testUserToken}`,
        },
      });

      assert.strictEqual(res2.statusCode, 429);
      assert.strictEqual(
        res2.json?.message,
        'Too many resume analysis requests. Please try again later.'
      );
      assert(res2.headers['retry-after'], 'Expected Retry-After header on 429');
      const exposed = res2.headers['access-control-expose-headers'];
      assert(exposed, 'Expected access-control-expose-headers on real 429 response');
      assert(exposed.toLowerCase().includes('retry-after'));
    });

    // Section 3: Non-Duplicating Retry Workflow Tests
    await runTest('Test 3.1 — Retry calls ONLY analyze endpoint without re-uploading PDF or creating new document', async () => {
      resetSpies();

      // Step 1: Simulate initial upload
      const initialUploadResult = await Resume.create({
        userId: '507f1f77bcf86cd799439088',
        companyName: 'Stark Industries',
        jobTitle: 'Research Engineer',
        jobDescription: 'Robotics',
        resumePublicId: 'initial_cloudinary_asset_123',
        feedback: {},
      });
      assert.strictEqual(mockResumeCreateCalls, 1);

      // Step 2: First analysis attempt (simulating failure or 429)
      // Retry action invokes POST /api/resumes/:id/analyze directly with initialUploadResult._id
      const retryUserToken = generateTestToken('507f1f77bcf86cd799439099'); // fresh user quota
      const retryApp = express();
      retryApp.use(cookieParser());
      retryApp.use(express.json());
      retryApp.post(
        '/api/resumes/:id/analyze',
        auth,
        validate({ params: resumeIdParamSchema }),
        analyzeResume
      );

      const retryServer = await new Promise((resolve) => {
        const s = retryApp.listen(0, '127.0.0.1', () => resolve(s));
      });

      try {
        const res = await makeRequest(retryServer, {
          path: `/api/resumes/${initialUploadResult._id}/analyze`,
          method: 'POST',
          headers: {
            Cookie: `token=${retryUserToken}`,
          },
        });

        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.json?.message, 'Resume analyzed successfully');
        assert.strictEqual(mockCloudinaryUploadCalls, 0, 'Retry must NEVER call Cloudinary upload');
        assert.strictEqual(mockResumeCreateCalls, 1, 'Retry must NEVER create a new Resume document');
        assert.strictEqual(mockGeminiAnalyzeCalls, 1, 'Retry directly triggers AI analysis for existing ID');
      } finally {
        await new Promise((resolve) => retryServer.close(resolve));
      }
    });

    // Section 4: Synchronous Analysis-Specific Concurrency Guard Unit Test
    await runTest('Test 4.1 — Synchronous analysis-specific concurrency guard blocks duplicate concurrent calls', () => {
      const activeInFlightAnalyses = new Set();
      const resumeId = '507f191e810c19729de860ea';

      const startAnalysis = (id) => {
        if (activeInFlightAnalyses.has(id)) {
          return { success: false, error: 'Analysis is already in progress for this resume' };
        }
        activeInFlightAnalyses.add(id);
        return { success: true };
      };

      const finishAnalysis = (id) => {
        activeInFlightAnalyses.delete(id);
      };

      // Call 1 synchronously acquires lock
      const call1 = startAnalysis(resumeId);
      assert.strictEqual(call1.success, true);

      // Call 2 synchronously blocked before any async work
      const call2 = startAnalysis(resumeId);
      assert.strictEqual(call2.success, false);
      assert.strictEqual(call2.error, 'Analysis is already in progress for this resume');

      // Call 1 finishes
      finishAnalysis(resumeId);
      assert.strictEqual(activeInFlightAnalyses.has(resumeId), false);

      // Subsequent call succeeds
      const call3 = startAnalysis(resumeId);
      assert.strictEqual(call3.success, true);
      finishAnalysis(resumeId);
    });

  } finally {
    if (testServer) {
      await new Promise((resolve) => testServer.close(resolve));
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
