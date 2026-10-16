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
process.env.JWT_SECRET = 'test_jwt_secret_validation_suite_32_chars_long';

// 1. Establish Service and Model Mocks BEFORE requiring routes/controllers
const User = require('../server/models/User');
const Resume = require('../server/models/Resume');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');

// Spies and call tracking
let mockCloudinaryUploadCalls = 0;
let mockCloudinaryDeleteCalls = 0;
let mockGeminiAnalyzeCalls = 0;
let mockResumeFindOneCalls = 0;
let mockResumeCreateCalls = 0;
let mockUserFindOneCalls = 0;
let mockUserCreateCalls = 0;
let capturedCreatedUser = null;
let capturedCreatedResume = null;

const resetSpies = () => {
  mockCloudinaryUploadCalls = 0;
  mockCloudinaryDeleteCalls = 0;
  mockGeminiAnalyzeCalls = 0;
  mockResumeFindOneCalls = 0;
  mockResumeCreateCalls = 0;
  mockUserFindOneCalls = 0;
  mockUserCreateCalls = 0;
  capturedCreatedUser = null;
  capturedCreatedResume = null;
};

// Wire default spy implementations
cloudinaryService.uploadPdfBuffer = async (buffer) => {
  mockCloudinaryUploadCalls++;
  return { public_id: 'mock_cloudinary_public_id_123' };
};

cloudinaryService.deletePdfAsset = async (publicId) => {
  mockCloudinaryDeleteCalls++;
  return { result: 'ok' };
};

cloudinaryService.generateSignedUrl = (publicId) => {
  return `https://res.cloudinary.com/mock/image/upload/signed/${publicId}.pdf`;
};

aiService.analyzeResumeWithGemini = async (text, jobDescription) => {
  mockGeminiAnalyzeCalls++;
  return {
    score: 88,
    feedback: { strengths: ['Good experience'], improvements: ['More metrics'] },
  };
};

User.findOne = async (query) => {
  mockUserFindOneCalls++;
  return null;
};

User.create = async (doc) => {
  mockUserCreateCalls++;
  capturedCreatedUser = doc;
  return {
    _id: '507f1f77bcf86cd799439011',
    name: doc.name,
    email: doc.email,
    createdAt: new Date(),
  };
};

Resume.findOne = async (query) => {
  mockResumeFindOneCalls++;
  return {
    _id: query._id || '507f1f77bcf86cd799439011',
    userId: query.userId,
    companyName: 'Acme Corp',
    jobTitle: 'Software Engineer',
    resumePublicId: 'mock_public_id',
    toObject() {
      return {
        _id: this._id,
        userId: this.userId,
        companyName: this.companyName,
        jobTitle: this.jobTitle,
        resumePublicId: this.resumePublicId,
      };
    },
    save: async () => {},
  };
};

Resume.create = async (doc) => {
  mockResumeCreateCalls++;
  capturedCreatedResume = doc;
  return {
    _id: '507f1f77bcf86cd799439011',
    ...doc,
    createdAt: new Date(),
  };
};

// 2. Import Production Routers, Schemas, and Error Handler
const authRoutes = require('../server/routes/authRoutes');
const resumeRoutes = require('../server/routes/resumeRoutes');
const validate = require('../server/middleware/validate');
const { errorHandler, AppError } = require('../server/middleware/errorHandler');
const { objectIdSchema, objectIdParamSchema } = require('../server/schemas/commonSchemas');
const { registerBodySchema, loginBodySchema } = require('../server/schemas/authSchemas');
const { createResumeBodySchema, resumeIdParamSchema } = require('../server/schemas/resumeSchemas');

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
 * Builds and sends a multipart/form-data request to test upload routes.
 */
const makeMultipartRequest = (server, options = {}, fields = {}, file = null) => {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const boundary = '----WebKitFormBoundaryValidationTest' + Math.random().toString(36).substring(2);
    const crlf = '\r\n';
    const parts = [];

    // Append text fields
    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`));
    }

    // Append file if provided
    if (file) {
      parts.push(
        Buffer.from(
          `--${boundary}${crlf}Content-Disposition: form-data; name="${file.fieldname || 'resume'}"; filename="${file.filename || 'resume.pdf'}"${crlf}Content-Type: ${file.mimetype || 'application/pdf'}${crlf}${crlf}`
        )
      );
      parts.push(file.buffer || Buffer.from('%PDF-1.4 Mock PDF content'));
      parts.push(Buffer.from(crlf));
    }

    parts.push(Buffer.from(`--${boundary}--${crlf}`));
    const payload = Buffer.concat(parts);

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

const generateTestToken = (userId = '507f1f77bcf86cd799439011') => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

// =========================================================================
// Main Test Execution
// =========================================================================
const runAllTests = async () => {
  console.log('\n====================================================');
  console.log('Step 1.3: Zod Request Validation Tests');
  console.log('====================================================\n');

  let server;
  try {
    server = await startTestServer();
  } catch (err) {
    console.error('Failed to start test server:', err);
    process.exit(1);
  }

  try {
    // -----------------------------------------------------------------------
    // Section 1: Schema Unit Tests
    // -----------------------------------------------------------------------
    await runTest('Test 1 — registerBodySchema accepts valid payload, trims inputs, and strips unknown fields', () => {
      const res = registerBodySchema.safeParse({
        name: '   Jane Doe   ',
        email: '   jane@example.com   ',
        password: 'validpassword123',
        extraField: 'shouldBeStripped',
        role: 'admin',
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.name, 'Jane Doe');
      assert.strictEqual(res.data.email, 'jane@example.com');
      assert.strictEqual(res.data.password, 'validpassword123');
      assert.strictEqual(res.data.extraField, undefined);
      assert.strictEqual(res.data.role, undefined);
    });

    await runTest('Test 2 — registerBodySchema rejects missing or empty name', () => {
      const res1 = registerBodySchema.safeParse({ email: 'jane@example.com', password: 'password123' });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.issues[0].message, 'Name is required');

      const res2 = registerBodySchema.safeParse({ name: '    ', email: 'jane@example.com', password: 'password123' });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Name is required');
    });

    await runTest('Test 3 — registerBodySchema rejects name exceeding 100 characters', () => {
      const res = registerBodySchema.safeParse({
        name: 'a'.repeat(101),
        email: 'jane@example.com',
        password: 'password123',
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.issues[0].message, 'Name cannot exceed 100 characters');
    });

    await runTest('Test 4 — registerBodySchema rejects missing or malformed email', () => {
      const res1 = registerBodySchema.safeParse({ name: 'Jane', password: 'password123' });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.issues[0].message, 'Email is required');

      const res2 = registerBodySchema.safeParse({ name: 'Jane', email: 'not-an-email', password: 'password123' });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Invalid email address');
    });

    await runTest('Test 5 — registerBodySchema rejects password shorter than 6 characters', () => {
      const res = registerBodySchema.safeParse({
        name: 'Jane',
        email: 'jane@example.com',
        password: '12345',
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.issues[0].message, 'Password must be at least 6 characters long');
    });

    await runTest('Test 6 — registerBodySchema validates 72 UTF-8 bytes ceiling (allows 18 emojis, rejects 19 emojis)', () => {
      const emoji18 = '🔒'.repeat(18); // 18 * 4 = 72 UTF-8 bytes, length 36
      assert.strictEqual(Buffer.byteLength(emoji18, 'utf8'), 72);
      const res1 = registerBodySchema.safeParse({
        name: 'Jane',
        email: 'jane@example.com',
        password: emoji18,
      });
      assert.strictEqual(res1.success, true);

      const emoji19 = '🔒'.repeat(19); // 19 * 4 = 76 UTF-8 bytes, length 38
      assert.strictEqual(Buffer.byteLength(emoji19, 'utf8'), 76);
      const res2 = registerBodySchema.safeParse({
        name: 'Jane',
        email: 'jane@example.com',
        password: emoji19,
      });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Password cannot exceed 72 bytes');
    });

    await runTest('Test 7 — loginBodySchema accepts valid credentials and allows passwords > 72 bytes', () => {
      const longPassword = 'p'.repeat(90);
      const res = loginBodySchema.safeParse({
        email: 'user@example.com',
        password: longPassword,
        unknownProp: 'stripMe',
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.email, 'user@example.com');
      assert.strictEqual(res.data.password, longPassword);
      assert.strictEqual(res.data.unknownProp, undefined);
    });

    await runTest('Test 8 — loginBodySchema rejects missing email and empty password', () => {
      const res1 = loginBodySchema.safeParse({ password: 'pass' });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.issues[0].message, 'Email is required');

      const res2 = loginBodySchema.safeParse({ email: 'user@example.com', password: '' });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Password is required');
    });

    await runTest('Test 9 — createResumeBodySchema accepts valid text fields and applies default empty string to jobDescription', () => {
      const res = createResumeBodySchema.safeParse({
        companyName: '   Google   ',
        jobTitle: '   Software Engineer   ',
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.companyName, 'Google');
      assert.strictEqual(res.data.jobTitle, 'Software Engineer');
      assert.strictEqual(res.data.jobDescription, '');
    });

    await runTest('Test 10 — createResumeBodySchema rejects missing companyName or jobTitle', () => {
      const res1 = createResumeBodySchema.safeParse({ jobTitle: 'Dev' });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.issues[0].message, 'Company name is required');

      const res2 = createResumeBodySchema.safeParse({ companyName: 'Acme' });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Job title is required');
    });

    await runTest('Test 11 — createResumeBodySchema rejects companyName or jobTitle > 100 characters', () => {
      const res1 = createResumeBodySchema.safeParse({
        companyName: 'c'.repeat(101),
        jobTitle: 'Dev',
      });
      assert.strictEqual(res1.success, false);
      assert.strictEqual(res1.error.issues[0].message, 'Company name cannot exceed 100 characters');

      const res2 = createResumeBodySchema.safeParse({
        companyName: 'Acme',
        jobTitle: 'j'.repeat(101),
      });
      assert.strictEqual(res2.success, false);
      assert.strictEqual(res2.error.issues[0].message, 'Job title cannot exceed 100 characters');
    });

    await runTest('Test 12 — createResumeBodySchema rejects jobDescription > 20000 characters', () => {
      const res = createResumeBodySchema.safeParse({
        companyName: 'Acme',
        jobTitle: 'Dev',
        jobDescription: 'x'.repeat(20001),
      });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.issues[0].message, 'Job description cannot exceed 20000 characters');
    });

    await runTest('Test 13 — resumeIdParamSchema accepts 24-character hex ID and rejects non-hex / malformed ID', () => {
      const valid = resumeIdParamSchema.safeParse({ id: '507f1f77bcf86cd799439011' });
      assert.strictEqual(valid.success, true);

      const nonHex = resumeIdParamSchema.safeParse({ id: '507f1f77bcf86cd79943901g' });
      assert.strictEqual(nonHex.success, false);
      assert.strictEqual(nonHex.error.issues[0].message, 'Invalid resume ID format');

      const shortId = resumeIdParamSchema.safeParse({ id: '12345' });
      assert.strictEqual(shortId.success, false);
      assert.strictEqual(shortId.error.issues[0].message, 'Invalid resume ID format');
    });

    await runTest('Test 14 — validate middleware rejects missing, null, or non-object input explicitly', () => {
      const mw = validate({ body: registerBodySchema });
      let caughtErr1 = null;
      mw({}, {}, (err) => { caughtErr1 = err; });
      assert(caughtErr1 instanceof AppError);
      assert.strictEqual(caughtErr1.statusCode, 400);
      assert.strictEqual(caughtErr1.message, 'Request body must be a valid object');

      let caughtErr2 = null;
      mw({ body: null }, {}, (err) => { caughtErr2 = err; });
      assert(caughtErr2 instanceof AppError);
      assert.strictEqual(caughtErr2.statusCode, 400);
      assert.strictEqual(caughtErr2.message, 'Request body must be a valid object');
    });

    // -----------------------------------------------------------------------
    // Section 2: Authentication Production Route Integration Tests
    // -----------------------------------------------------------------------
    await runTest('Test 15 — POST /api/auth/register missing name returns 400 and safe message', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        email: 'test@example.com',
        password: 'password123',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Name is required');
      assert.strictEqual(mockUserCreateCalls, 0);
    });

    await runTest('Test 16 — POST /api/auth/register malformed email returns 400 and safe message', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Test User',
        email: 'invalid-email-format',
        password: 'password123',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Invalid email address');
      assert.strictEqual(mockUserCreateCalls, 0);
    });

    await runTest('Test 17 — POST /api/auth/register short password returns 400 and safe message', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Test User',
        email: 'valid@example.com',
        password: '123',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Password must be at least 6 characters long');
      assert.strictEqual(mockUserCreateCalls, 0);
    });

    await runTest('Test 18 — POST /api/auth/register password > 72 UTF-8 bytes returns 400', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Test User',
        email: 'valid@example.com',
        password: '🔒'.repeat(19),
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Password cannot exceed 72 bytes');
      assert.strictEqual(mockUserCreateCalls, 0);
    });

    await runTest('Test 19 — POST /api/auth/register sensitive dummy password is NEVER reflected in response', async () => {
      const secretPass = 'SUPER_SECRET_USER_PASSWORD_XYZ99';
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: 'Test User',
        email: 'not-an-email',
        password: secretPass,
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.includes(secretPass), false);
    });

    await runTest('Test 20 — POST /api/auth/register valid payload returns 201 and strips unknown fields before User.create', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/register', method: 'POST' }, {
        name: '  Jane Doe  ',
        email: '  jane@example.com  ',
        password: 'securepassword123',
        injectedRole: 'admin',
        isOperational: true,
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.json?.message, 'User registered successfully');
      assert.strictEqual(mockUserCreateCalls, 1);
      assert.strictEqual(capturedCreatedUser.name, 'Jane Doe');
      assert.strictEqual(capturedCreatedUser.email, 'jane@example.com');
      assert.strictEqual(capturedCreatedUser.injectedRole, undefined);
      assert.strictEqual(capturedCreatedUser.isOperational, undefined);
    });

    await runTest('Test 21 — POST /api/auth/login malformed email returns 400 with Invalid email address', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'bad-email-login',
        password: 'somepassword123',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Invalid email address');
      assert.strictEqual(mockUserFindOneCalls, 0);
    });

    await runTest('Test 22 — POST /api/auth/login empty password returns 400 with Password is required', async () => {
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'valid@example.com',
        password: '',
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Password is required');
      assert.strictEqual(mockUserFindOneCalls, 0);
    });

    await runTest('Test 23 — POST /api/auth/login password > 72 bytes is permitted by validation to reach authentication', async () => {
      // In login, long passwords must not be rejected at validation layer
      const res = await makeJsonRequest(server, { path: '/api/auth/login', method: 'POST' }, {
        email: 'valid@example.com',
        password: 'p'.repeat(85),
      });
      // Mock User.findOne returns null -> controller returns 401 Invalid email or password
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.message, 'Invalid email or password');
      assert.strictEqual(mockUserFindOneCalls, 1, 'Should call User.findOne for authentication');
    });

    // -----------------------------------------------------------------------
    // Section 3: Resume Creation & Multipart Tests (POST /api/resumes)
    // -----------------------------------------------------------------------
    await runTest('Test 24 — POST /api/resumes unauthenticated request is blocked by auth with 401 before Multer or validation', async () => {
      const res = await makeMultipartRequest(server, { path: '/api/resumes', method: 'POST' }, {
        companyName: 'Acme Corp',
        jobTitle: 'Software Engineer',
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.message, 'Unauthorized: No token provided');
      assert.strictEqual(mockCloudinaryUploadCalls, 0);
      assert.strictEqual(mockResumeCreateCalls, 0);
    });

    await runTest('Test 25 — POST /api/resumes missing companyName returns 400 and asserts Cloudinary upload is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeMultipartRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${token}` },
        },
        {
          jobTitle: 'Software Engineer',
          jobDescription: 'Sample description',
        },
        {
          fieldname: 'resume',
          filename: 'cv.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 Mock PDF Stream'),
        }
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Company name is required');
      assert.strictEqual(mockCloudinaryUploadCalls, 0, 'Cloudinary uploadPdfBuffer MUST NOT be called');
      assert.strictEqual(mockResumeCreateCalls, 0, 'Resume.create MUST NOT be called');
    });

    await runTest('Test 26 — POST /api/resumes missing jobTitle returns 400 and asserts Cloudinary upload is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeMultipartRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${token}` },
        },
        {
          companyName: 'Acme Corp',
        },
        {
          fieldname: 'resume',
          filename: 'cv.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 Mock PDF Stream'),
        }
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Job title is required');
      assert.strictEqual(mockCloudinaryUploadCalls, 0, 'Cloudinary uploadPdfBuffer MUST NOT be called');
      assert.strictEqual(mockResumeCreateCalls, 0, 'Resume.create MUST NOT be called');
    });

    await runTest('Test 27 — POST /api/resumes jobDescription > 20000 chars returns 400 and asserts Cloudinary is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeMultipartRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${token}` },
        },
        {
          companyName: 'Acme Corp',
          jobTitle: 'Software Engineer',
          jobDescription: 'd'.repeat(20001),
        },
        {
          fieldname: 'resume',
          filename: 'cv.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 Mock PDF Stream'),
        }
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Job description cannot exceed 20000 characters');
      assert.strictEqual(mockCloudinaryUploadCalls, 0, 'Cloudinary uploadPdfBuffer MUST NOT be called');
      assert.strictEqual(mockResumeCreateCalls, 0, 'Resume.create MUST NOT be called');
    });

    await runTest('Test 28 — POST /api/resumes valid multipart upload calls Cloudinary and Resume.create with stripped fields', async () => {
      const token = generateTestToken();
      const res = await makeMultipartRequest(
        server,
        {
          path: '/api/resumes',
          method: 'POST',
          headers: { Cookie: `token=${token}` },
        },
        {
          companyName: '  Acme Corp  ',
          jobTitle: '  Software Engineer  ',
          jobDescription: '  Great position  ',
          maliciousFormField: 'dropMe',
        },
        {
          fieldname: 'resume',
          filename: 'cv.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 Mock PDF Stream'),
        }
      );
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.json?.message, 'Resume created successfully');
      assert.strictEqual(mockCloudinaryUploadCalls, 1, 'Cloudinary uploadPdfBuffer MUST be called for valid payload');
      assert.strictEqual(mockResumeCreateCalls, 1, 'Resume.create MUST be called for valid payload');
      assert.strictEqual(capturedCreatedResume.companyName, 'Acme Corp');
      assert.strictEqual(capturedCreatedResume.jobTitle, 'Software Engineer');
      assert.strictEqual(capturedCreatedResume.jobDescription, 'Great position');
      assert.strictEqual(capturedCreatedResume.maliciousFormField, undefined);
    });

    // -----------------------------------------------------------------------
    // Section 4: Resume Route Parameter Validation Tests (:id)
    // -----------------------------------------------------------------------
    await runTest('Test 29 — GET /api/resumes/:id with non-hex ID returns 400 and asserts database is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeJsonRequest(server, {
        path: '/api/resumes/not-a-valid-hex-id-1234',
        method: 'GET',
        headers: { Cookie: `token=${token}` },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      assert.strictEqual(mockResumeFindOneCalls, 0, 'Resume.findOne MUST NOT be called for invalid ID');
    });

    await runTest('Test 30 — GET /api/resumes/:id with valid 24-hex ID passes validation and queries database', async () => {
      const token = generateTestToken();
      const res = await makeJsonRequest(server, {
        path: '/api/resumes/507f1f77bcf86cd799439011',
        method: 'GET',
        headers: { Cookie: `token=${token}` },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockResumeFindOneCalls, 1, 'Resume.findOne MUST be called for valid ID');
    });

    await runTest('Test 31 — DELETE /api/resumes/:id with non-hex ID returns 400 and asserts database is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeJsonRequest(server, {
        path: '/api/resumes/bad-id-5678',
        method: 'DELETE',
        headers: { Cookie: `token=${token}` },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      assert.strictEqual(mockResumeFindOneCalls, 0, 'Database lookup MUST NOT be called for invalid ID');
    });

    await runTest('Test 32 — POST /api/resumes/:id/analyze with non-hex ID returns 400 and asserts Gemini is called 0 times', async () => {
      const token = generateTestToken();
      const res = await makeJsonRequest(server, {
        path: '/api/resumes/malformed-resume-id/analyze',
        method: 'POST',
        headers: { Cookie: `token=${token}` },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Invalid resume ID format');
      assert.strictEqual(mockGeminiAnalyzeCalls, 0, 'Gemini analyzeResumeWithGemini MUST NOT be called');
      assert.strictEqual(mockResumeFindOneCalls, 0, 'Database lookup MUST NOT be called');
    });

    // -----------------------------------------------------------------------
    // Section 5: Empty Request Body Guard
    // -----------------------------------------------------------------------
    await runTest('Test 33 — POST /api/auth/register with empty object returns 400 and field-level messages', async () => {
      const res = await makeJsonRequest(
        server,
        {
          path: '/api/auth/register',
          method: 'POST',
        },
        {}
      );
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.json?.message, 'Name is required, Email is required, Password is required');
      assert.strictEqual(mockUserCreateCalls, 0);
    });

  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n====================================================');
  console.log(`Results: ${passedCount} passed, ${failedCount} failed`);
  console.log('====================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
};

runAllTests().catch((err) => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
