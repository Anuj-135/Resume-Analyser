const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Ensure isolated test environment configuration
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_authz_suite_32_chars_long';
process.env.CLIENT_URL = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// 1. Establish Service and Model Mocks BEFORE requiring routes/controllers
// ---------------------------------------------------------------------------
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');
const pdfService = require('../server/services/pdfService');

// Test identifiers
const USER_A_ID = '507f1f77bcf86cd799439001';
const USER_B_ID = '507f1f77bcf86cd799439002';
const USER_C_ID = '507f1f77bcf86cd799439003';

const RESUME_A1_ID = '507f1f77bcf86cd799439a01';
const RESUME_A2_ID = '507f1f77bcf86cd799439a02';
const RESUME_B1_ID = '507f1f77bcf86cd799439b01';
const RESUME_B2_ID = '507f1f77bcf86cd799439b02';
const RESUME_C1_ID = '507f1f77bcf86cd799439c01';

// Initial multi-tenant fixture state
const getInitialStore = () => [
  {
    _id: RESUME_A1_ID,
    userId: USER_A_ID,
    companyName: 'Company A1',
    jobTitle: 'Senior Software Engineer',
    jobDescription: 'Backend APIs with Node.js',
    resumePublicId: 'pub_a1',
    imagePath: '',
    feedback: {},
    createdAt: new Date('2026-10-01T10:00:00Z'),
  },
  {
    _id: RESUME_A2_ID,
    userId: USER_A_ID,
    companyName: 'Company A2',
    jobTitle: 'Lead Architect',
    jobDescription: 'System design and microservices',
    resumePublicId: 'pub_a2',
    imagePath: '',
    feedback: {},
    createdAt: new Date('2026-10-02T10:00:00Z'),
  },
  {
    _id: RESUME_B1_ID,
    userId: USER_B_ID,
    companyName: 'Company B1',
    jobTitle: 'Frontend Engineer',
    jobDescription: 'React and Next.js applications',
    resumePublicId: 'pub_b1',
    imagePath: '',
    feedback: {},
    createdAt: new Date('2026-10-03T10:00:00Z'),
  },
  {
    _id: RESUME_B2_ID,
    userId: USER_B_ID,
    companyName: 'Company B2',
    jobTitle: 'UI/UX Designer',
    jobDescription: 'Design systems and accessibility',
    resumePublicId: 'pub_b2',
    imagePath: '',
    feedback: {},
    createdAt: new Date('2026-10-04T10:00:00Z'),
  },
  {
    _id: RESUME_C1_ID,
    userId: USER_C_ID,
    companyName: 'Company C1',
    jobTitle: 'Data Engineer',
    jobDescription: 'ETL pipelines and analytics',
    resumePublicId: 'pub_c1',
    imagePath: '',
    feedback: {},
    createdAt: new Date('2026-10-05T10:00:00Z'),
  },
];

let resumeStore = getInitialStore();

// Spies for side-effect tracking
let mockGeminiAnalyzeCalls = 0;
let mockCloudinarySignedUrlCalls = 0;
let mockCloudinaryDeleteCalls = 0;
let mockCloudinaryUploadCalls = 0;
let mockPdfExtractCalls = 0;

/**
 * Wraps a raw document object with Mongoose document methods used by controllers.
 */
const wrapResumeDoc = (doc) => {
  if (!doc) return null;
  return {
    ...doc,
    toObject() {
      return JSON.parse(JSON.stringify(doc));
    },
    async save() {
      const idx = resumeStore.findIndex((r) => r._id.toString() === doc._id.toString());
      if (idx !== -1) {
        resumeStore[idx] = {
          ...resumeStore[idx],
          feedback: this.feedback !== undefined ? this.feedback : resumeStore[idx].feedback,
        };
      }
      return this;
    },
  };
};

/**
 * Matches a document against query filter criteria.
 */
const matchesQuery = (doc, query = {}) => {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const docVal = doc[key];
    const docValStr = docVal ? docVal.toString() : '';
    const queryValStr = value ? value.toString() : '';
    if (docValStr !== queryValStr) {
      return false;
    }
  }
  return true;
};

// Wire Mongoose Resume model mock faithfully representing query chains
Resume.find = (query = {}) => {
  const matching = resumeStore.filter((doc) => matchesQuery(doc, query));
  const wrapped = matching.map((doc) => wrapResumeDoc(doc));
  return {
    sort(sortObj = {}) {
      const sorted = [...wrapped].sort((a, b) => {
        if (sortObj.createdAt === -1) {
          return new Date(b.createdAt) - new Date(a.createdAt);
        }
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      return sorted;
    },
    then(resolve, reject) {
      return Promise.resolve(wrapped).then(resolve, reject);
    },
  };
};

Resume.findOne = async (query = {}) => {
  const found = resumeStore.find((doc) => matchesQuery(doc, query));
  return found ? wrapResumeDoc(found) : null;
};

Resume.findOneAndDelete = async (query = {}) => {
  const idx = resumeStore.findIndex((doc) => matchesQuery(doc, query));
  if (idx === -1) return null;
  const [deleted] = resumeStore.splice(idx, 1);
  return wrapResumeDoc(deleted);
};

Resume.deleteMany = async (query = {}) => {
  const initialCount = resumeStore.length;
  resumeStore = resumeStore.filter((doc) => !matchesQuery(doc, query));
  return { deletedCount: initialCount - resumeStore.length };
};

Resume.create = async (doc) => {
  const newDoc = {
    _id: doc._id || new mongoose.Types.ObjectId().toString(),
    userId: doc.userId,
    companyName: doc.companyName,
    jobTitle: doc.jobTitle,
    jobDescription: doc.jobDescription || '',
    resumePublicId: doc.resumePublicId || '',
    imagePath: doc.imagePath || '',
    feedback: doc.feedback || {},
    createdAt: doc.createdAt || new Date(),
  };
  resumeStore.push(newDoc);
  return wrapResumeDoc(newDoc);
};

// Wire external service spies
cloudinaryService.generateSignedUrl = (publicId) => {
  mockCloudinarySignedUrlCalls++;
  return `https://res.cloudinary.com/mock/image/upload/signed/${publicId}.pdf`;
};

cloudinaryService.deletePdfAsset = async (publicId) => {
  mockCloudinaryDeleteCalls++;
  return { result: 'ok' };
};

cloudinaryService.uploadPdfBuffer = async (buffer) => {
  mockCloudinaryUploadCalls++;
  return {
    public_id: 'mock_uploaded_public_id',
    secure_url: 'https://res.cloudinary.com/mock/image/upload/mock_uploaded_public_id.pdf',
  };
};

pdfService.extractTextFromPdf = async (publicId) => {
  mockPdfExtractCalls++;
  return 'Standard extracted resume text for authorization regression suite';
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
  _id: new mongoose.Types.ObjectId().toString(),
  name: doc.name,
  email: doc.email,
  createdAt: new Date(),
});

// ---------------------------------------------------------------------------
// 2. Import Production Routers, Controllers & Middleware
// ---------------------------------------------------------------------------
const authRoutes = require('../server/routes/authRoutes');
const resumeRoutes = require('../server/routes/resumeRoutes');
const { errorHandler, notFoundHandler } = require('../server/middleware/errorHandler');
const { csrfProtection } = require('../server/middleware/csrf');
const {
  globalAnalysisLimiter,
  uploadIpLimiter,
  uploadUserLimiter,
  analysisLimiter,
} = require('../server/middleware/rateLimiter');
const resumeController = require('../server/controllers/resumeController');

// Token generation helper
const generateTestToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
};

const tokenA = generateTestToken(USER_A_ID);
const tokenB = generateTestToken(USER_B_ID);
const tokenC = generateTestToken(USER_C_ID);

/**
 * Resets all fixtures, service spies, concurrency locks, and limiter state.
 */
const resetSpiesAndStore = () => {
  resumeStore = getInitialStore();
  mockGeminiAnalyzeCalls = 0;
  mockCloudinarySignedUrlCalls = 0;
  mockCloudinaryDeleteCalls = 0;
  mockCloudinaryUploadCalls = 0;
  mockPdfExtractCalls = 0;

  // Clear concurrency guard active locks
  if (resumeController._activeAnalyses) {
    resumeController._activeAnalyses.clear();
  }

  // Reset rate limiter state for clean test isolation
  globalAnalysisLimiter.resetKey('global_ai_analysis_bucket');
  uploadIpLimiter.resetKey('127.0.0.1');
  uploadUserLimiter.resetKey(USER_A_ID);
  uploadUserLimiter.resetKey(USER_B_ID);
  uploadUserLimiter.resetKey(USER_C_ID);
  analysisLimiter.resetKey(USER_A_ID);
  analysisLimiter.resetKey(USER_B_ID);
  analysisLimiter.resetKey(USER_C_ID);
};

// Test runner state
let passedCount = 0;
let failedCount = 0;

const runTest = async (name, testFn) => {
  try {
    resetSpiesAndStore();
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
 * Creates and starts an isolated Express test server matching production middleware stack.
 */
const startTestServer = () => {
  return new Promise((resolve) => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use(csrfProtection);

    app.use('/api/auth', authRoutes);
    app.use('/api/resumes', resumeRoutes);
    app.use(notFoundHandler);
    app.use(errorHandler);

    const server = app.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
};

/**
 * Issues an HTTP request to the test server with CSRF compliance by default.
 */
const makeJsonRequest = (server, options = {}, body = null) => {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const data = body !== null && typeof body === 'object' ? JSON.stringify(body) : body;

    const headers = {
      Origin: 'http://localhost:3000',
      'X-Requested-With': 'XMLHttpRequest',
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
  console.log('Phase 1 Remediation R-3: Cross-User Authorization Test Suite');
  console.log('====================================================\n');

  let server;
  try {
    server = await startTestServer();

    // -----------------------------------------------------------------------
    // Section 1: Read Isolation
    // -----------------------------------------------------------------------

    // Test 1: User A cannot retrieve User B's resume by ID
    await runTest('Test 1 — User A cannot retrieve User B resume by ID (404 and zero signed URLs)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}`,
        method: 'GET',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 404, 'Must return HTTP 404');
      assert.strictEqual(res.json?.message, 'Resume not found');
      assert.strictEqual(mockCloudinarySignedUrlCalls, 0, 'Signed URL must not be generated for unowned resume');
      assert.strictEqual(resumeStore.length, 5, 'Database records must remain untouched');
    });

    // Test 2: Legitimate owner can retrieve own resume by ID
    await runTest('Test 2 — Legitimate owner can retrieve own resume by ID (200 with signed URL)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_A1_ID}`,
        method: 'GET',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.resume?._id, RESUME_A1_ID);
      assert.strictEqual(res.json?.resume?.companyName, 'Company A1');
      assert(res.json?.resume?.resumeUrl?.includes('signed/pub_a1.pdf'), 'Must include signed Cloudinary URL');
      assert.strictEqual(mockCloudinarySignedUrlCalls, 1);
    });

    // Test 3: User A list query strictly isolates User A's resumes
    await runTest('Test 3 — User A list query strictly returns only User A resumes and zero foreign records', async () => {
      const res = await makeJsonRequest(server, {
        path: '/api/resumes',
        method: 'GET',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.count, 2);
      assert.strictEqual(res.json?.resumes?.length, 2);

      const returnedIds = res.json.resumes.map((r) => r._id);
      assert.deepStrictEqual(
        returnedIds.sort(),
        [RESUME_A1_ID, RESUME_A2_ID].sort(),
        'Must contain exactly User A resume IDs'
      );
      assert.strictEqual(
        res.json.resumes.some((r) => r.userId !== USER_A_ID),
        false,
        'Zero foreign userId records allowed'
      );
      assert.strictEqual(
        res.json.resumes.some((r) => r._id === RESUME_B1_ID || r._id === RESUME_B2_ID || r._id === RESUME_C1_ID),
        false,
        'Zero User B or User C resumes allowed'
      );
      assert.strictEqual(resumeStore.length, 5, 'Shared database store remains completely intact');
    });

    // Test 4: User B list query strictly isolates User B's resumes (Reciprocal)
    await runTest('Test 4 — User B list query strictly returns only User B resumes and zero foreign records', async () => {
      const res = await makeJsonRequest(server, {
        path: '/api/resumes',
        method: 'GET',
        headers: { Cookie: `token=${tokenB}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.count, 2);
      assert.strictEqual(res.json?.resumes?.length, 2);

      const returnedIds = res.json.resumes.map((r) => r._id);
      assert.deepStrictEqual(
        returnedIds.sort(),
        [RESUME_B1_ID, RESUME_B2_ID].sort(),
        'Must contain exactly User B resume IDs'
      );
      assert.strictEqual(
        res.json.resumes.some((r) => r.userId !== USER_B_ID),
        false,
        'Zero foreign userId records allowed'
      );
      assert.strictEqual(
        res.json.resumes.some((r) => r._id === RESUME_A1_ID || r._id === RESUME_A2_ID || r._id === RESUME_C1_ID),
        false,
        'Zero User A or User C resumes allowed'
      );
    });

    // -----------------------------------------------------------------------
    // Section 2: Mutation & Deletion Isolation
    // -----------------------------------------------------------------------

    // Test 5: User A cannot delete User B's resume by ID
    await runTest('Test 5 — User A cannot delete User B resume by ID (404 and Cloudinary deletion bypassed)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}`,
        method: 'DELETE',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.json?.message, 'Resume not found');
      assert.strictEqual(mockCloudinaryDeleteCalls, 0, 'Cloudinary asset must not be deleted on unauthorized attempt');
      assert(
        resumeStore.some((r) => r._id === RESUME_B1_ID),
        'User B resume must remain present in database'
      );
      assert.strictEqual(resumeStore.length, 5);
    });

    // Test 6: Legitimate owner can delete own resume by ID
    await runTest('Test 6 — Legitimate owner can delete own resume by ID (200 with Cloudinary asset cleanup)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}`,
        method: 'DELETE',
        headers: { Cookie: `token=${tokenB}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.message, 'Resume deleted successfully');
      assert.strictEqual(mockCloudinaryDeleteCalls, 1, 'Cloudinary asset deletion must be called for legitimate owner');
      assert.strictEqual(
        resumeStore.some((r) => r._id === RESUME_B1_ID),
        false,
        'Resume B1 must be removed from database'
      );
      assert.strictEqual(resumeStore.length, 4);
    });

    // Test 7: User A bulk delete wipes ONLY User A's resumes
    await runTest('Test 7 — User A bulk delete wipes only User A resumes and leaves foreign records intact', async () => {
      const res = await makeJsonRequest(server, {
        path: '/api/resumes',
        method: 'DELETE',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.deletedCount, 2);
      assert.strictEqual(res.json?.message, 'All resumes deleted successfully');

      // Assert User A records removed, while User B and User C remain intact
      assert.strictEqual(
        resumeStore.filter((r) => r.userId === USER_A_ID).length,
        0,
        'User A resumes must be deleted'
      );
      assert.strictEqual(
        resumeStore.filter((r) => r.userId === USER_B_ID).length,
        2,
        'User B resumes must remain intact'
      );
      assert.strictEqual(
        resumeStore.filter((r) => r.userId === USER_C_ID).length,
        1,
        'User C resume must remain intact'
      );
      assert.strictEqual(resumeStore.length, 3, 'Exactly 3 foreign resumes remain');
      assert.strictEqual(mockCloudinaryDeleteCalls, 2, 'Cloudinary delete called strictly for User A assets');
    });

    // Test 8: Creation strictly ignores client-supplied userId tampering
    await runTest('Test 8 — Resume creation ignores client-supplied userId in payload and binds to auth token', async () => {
      const res = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${tokenA}` },
        },
        {
          companyName: 'SpoofCorp',
          jobTitle: 'Security Tester',
          userId: USER_B_ID,
        }
      );
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.json?.message, 'Resume created successfully');

      const createdDoc = resumeStore.find((r) => r.companyName === 'SpoofCorp');
      assert(createdDoc, 'Resume must be created');
      assert.strictEqual(
        createdDoc.userId.toString(),
        USER_A_ID,
        'Created resume must strictly belong to authenticated User A'
      );
      assert.notStrictEqual(
        createdDoc.userId.toString(),
        USER_B_ID,
        'Client-supplied User B ID must be strictly ignored'
      );
    });

    // Test 9: Creation strictly ignores client-injected feedback and imagePath
    await runTest('Test 9 — Resume creation ignores client-injected feedback and imagePath in payload', async () => {
      const res = await makeJsonRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${tokenA}` },
        },
        {
          companyName: 'InjectedCorp',
          jobTitle: 'QA Engineer',
          feedback: { score: 100, overallScore: 100 },
          imagePath: '/malicious/path.jpg',
        }
      );
      assert.strictEqual(res.statusCode, 201);

      const createdDoc = resumeStore.find((r) => r.companyName === 'InjectedCorp');
      assert(createdDoc);
      assert.deepStrictEqual(createdDoc.feedback, {}, 'Feedback must default to empty object');
      assert.strictEqual(createdDoc.imagePath, '', 'ImagePath must default to empty string');
    });

    // Test 10: Unsupported mutation methods (PUT/PATCH) return 404 Route not found
    await runTest('Test 10 — Unsupported mutation methods (PUT/PATCH) return HTTP 404 Route not found', async () => {
      const resPut = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${RESUME_B1_ID}`,
          method: 'PUT',
          headers: { Cookie: `token=${tokenA}` },
        },
        { companyName: 'Hacked' }
      );
      assert.strictEqual(resPut.statusCode, 404);
      assert.strictEqual(resPut.json?.message, 'Route not found');

      const resPatch = await makeJsonRequest(
        server,
        {
          path: `/api/resumes/${RESUME_B1_ID}`,
          method: 'PATCH',
          headers: { Cookie: `token=${tokenA}` },
        },
        { companyName: 'Hacked' }
      );
      assert.strictEqual(resPatch.statusCode, 404);
      assert.strictEqual(resPatch.json?.message, 'Route not found');

      const b1 = resumeStore.find((r) => r._id === RESUME_B1_ID);
      assert.strictEqual(b1.companyName, 'Company B1', 'Target document in database must remain unmodified');
    });

    // -----------------------------------------------------------------------
    // Section 3: AI Analysis Isolation
    // -----------------------------------------------------------------------

    // Test 11: User A cannot initiate analysis of User B's resume
    await runTest('Test 11 — User A cannot initiate analysis of User B resume (404 and Gemini bypass)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}/analyze`,
        method: 'POST',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.json?.message, 'Resume not found');
      assert.strictEqual(mockGeminiAnalyzeCalls, 0, 'Gemini AI service must not be invoked on unowned resume');
      assert.strictEqual(mockPdfExtractCalls, 0, 'PDF extraction must not be invoked on unowned resume');

      const b1 = resumeStore.find((r) => r._id === RESUME_B1_ID);
      assert.deepStrictEqual(b1.feedback, {}, 'Feedback in database must remain unmodified');
    });

    // Test 12: Legitimate owner can initiate analysis of own resume
    await runTest('Test 12 — Legitimate owner can initiate analysis of own resume (200 with Gemini feedback)', async () => {
      const res = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}/analyze`,
        method: 'POST',
        headers: { Cookie: `token=${tokenB}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.message, 'Resume analyzed successfully');
      assert.strictEqual(res.json?.feedback?.score, 88);
      assert.strictEqual(mockGeminiAnalyzeCalls, 1);
      assert.strictEqual(mockPdfExtractCalls, 1);

      const b1 = resumeStore.find((r) => r._id === RESUME_B1_ID);
      assert.strictEqual(b1.feedback.score, 88, 'Feedback in database must be persisted');
    });

    // Test 13: Unauthorized analysis attempt does NOT acquire owner's concurrency lock
    await runTest('Test 13 — Unauthorized analysis attempt does not acquire or block owner concurrency slot', async () => {
      // User A attempts to analyze User B's resume (rejected with 404)
      const resA = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}/analyze`,
        method: 'POST',
        headers: { Cookie: `token=${tokenA}` },
      });
      assert.strictEqual(resA.statusCode, 404);

      // Verify User B's lock key is NOT held
      const userBLockKey = JSON.stringify([USER_B_ID, RESUME_B1_ID]);
      assert.strictEqual(
        resumeController._activeAnalyses.has(userBLockKey),
        false,
        'User B lock key must not be held'
      );

      // Legitimate User B immediately initiates analysis of the same resume
      const resB = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}/analyze`,
        method: 'POST',
        headers: { Cookie: `token=${tokenB}` },
      });
      assert.strictEqual(resB.statusCode, 200, 'User B must not receive 409 Conflict');
    });

    // Test 14: Unauthorized analysis attempts do NOT consume target owner's rate limit quota
    await runTest('Test 14 — Cross-user analysis attempts do not consume victim per-user analysis quota', async () => {
      // User A makes 4 cross-user analysis attempts against User B's resume (all return 404)
      for (let i = 1; i <= 4; i++) {
        const resA = await makeJsonRequest(server, {
          path: `/api/resumes/${RESUME_B1_ID}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${tokenA}` },
        });
        assert.strictEqual(resA.statusCode, 404);
      }

      // User B has a 5 req/hr personal analysis quota.
      // Verify User B can make all 5 legitimate analysis requests successfully.
      for (let i = 1; i <= 5; i++) {
        const resB = await makeJsonRequest(server, {
          path: `/api/resumes/${RESUME_B1_ID}/analyze`,
          method: 'POST',
          headers: { Cookie: `token=${tokenB}` },
        });
        assert.strictEqual(resB.statusCode, 200, `User B analysis request ${i} must succeed`);
      }

      // User B's 6th request hits their per-user quota (429)
      const resB6 = await makeJsonRequest(server, {
        path: `/api/resumes/${RESUME_B1_ID}/analyze`,
        method: 'POST',
        headers: { Cookie: `token=${tokenB}` },
      });
      assert.strictEqual(resB6.statusCode, 429);
      assert.strictEqual(resB6.json?.message, 'Too many resume analysis requests. Please try again later.');
    });

    // -----------------------------------------------------------------------
    // Section 4: Boundaries, Authentication & Data Non-Disclosure
    // -----------------------------------------------------------------------

    // Test 15: Malformed resume ID rejected before database query
    await runTest('Test 15 — Malformed resume ID format rejected with 400 before database lookup', async () => {
      const endpoints = [
        { path: '/api/resumes/not-a-24-hex-id', method: 'GET' },
        { path: '/api/resumes/not-a-24-hex-id/analyze', method: 'POST' },
        { path: '/api/resumes/not-a-24-hex-id', method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await makeJsonRequest(server, {
          path: ep.path,
          method: ep.method,
          headers: { Cookie: `token=${tokenA}` },
        });
        assert.strictEqual(res.statusCode, 400, `${ep.method} ${ep.path} must return 400`);
        assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      }
    });

    // Test 16: Valid format but nonexistent ID returns uniform 404
    await runTest('Test 16 — Valid format but nonexistent ID returns uniform HTTP 404', async () => {
      const fakeId = '507f1f77bcf86cd7994390ff';
      const endpoints = [
        { path: `/api/resumes/${fakeId}`, method: 'GET' },
        { path: `/api/resumes/${fakeId}/analyze`, method: 'POST' },
        { path: `/api/resumes/${fakeId}`, method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await makeJsonRequest(server, {
          path: ep.path,
          method: ep.method,
          headers: { Cookie: `token=${tokenA}` },
        });
        assert.strictEqual(res.statusCode, 404, `${ep.method} ${ep.path} must return 404`);
        assert.strictEqual(res.json?.message, 'Resume not found');
      }
    });

    // Test 17: Unauthenticated requests rejected across all resume routes
    await runTest('Test 17 — Unauthenticated requests return 401 across all resume endpoints', async () => {
      const endpoints = [
        { path: '/api/resumes', method: 'GET' },
        { path: `/api/resumes/${RESUME_B1_ID}`, method: 'GET' },
        { path: '/api/resumes', method: 'POST', body: { companyName: 'A', jobTitle: 'B' } },
        { path: `/api/resumes/${RESUME_B1_ID}/analyze`, method: 'POST' },
        { path: `/api/resumes/${RESUME_B1_ID}`, method: 'DELETE' },
        { path: '/api/resumes', method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await makeJsonRequest(server, { path: ep.path, method: ep.method }, ep.body || null);
        assert.strictEqual(res.statusCode, 401, `${ep.method} ${ep.path} must return 401`);
        assert.strictEqual(res.json?.message, 'Unauthorized: No token provided');
      }
    });

    // Test 18: Cross-user 404 responses disclose zero foreign metadata or secrets
    await runTest('Test 18 — Cross-user 404 responses disclose zero foreign metadata or secrets', async () => {
      const endpoints = [
        { path: `/api/resumes/${RESUME_B1_ID}`, method: 'GET' },
        { path: `/api/resumes/${RESUME_B1_ID}/analyze`, method: 'POST' },
        { path: `/api/resumes/${RESUME_B1_ID}`, method: 'DELETE' },
      ];

      for (const ep of endpoints) {
        const res = await makeJsonRequest(server, {
          path: ep.path,
          method: ep.method,
          headers: { Cookie: `token=${tokenA}` },
        });
        assert.strictEqual(res.statusCode, 404);

        const responseData = JSON.stringify(res.headers) + ' ' + res.body;
        assert(!responseData.includes('pub_b1'), 'Must not disclose Cloudinary public ID');
        assert(!responseData.includes('Company B1'), 'Must not disclose foreign company name');
        assert(!responseData.includes('Frontend Engineer'), 'Must not disclose foreign job title');
        assert(!responseData.includes(USER_B_ID), 'Must not disclose foreign user ID');
        assert(!responseData.includes('mongodb'), 'Must not disclose database connection strings');
      }
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
