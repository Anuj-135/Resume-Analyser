const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const { analyzeResume, _activeAnalyses } = require('../server/controllers/resumeController');
const Resume = require('../server/models/Resume');
const pdfService = require('../server/services/pdfService');
const aiService = require('../server/services/aiService');

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

const createMockResponse = () => {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      this.headersSent = true;
      return this;
    },
  };
  return res;
};

(async () => {
  console.log('====================================================');
  console.log('Step 1.4 — Phase 2: AI Concurrency Guard Unit Tests');
  console.log('====================================================\n');

  // Reset active locks before testing
  _activeAnalyses.clear();

  // Test 1: Collision-safe composite key isolation
  await runTest('Test 1 — Composite lock keys are strictly orthogonal across users and resumes', () => {
    const key1 = JSON.stringify(['user_1', 'resume_1']);
    const key2 = JSON.stringify(['user_2', 'resume_1']);
    const key3 = JSON.stringify(['user_1', 'resume_2']);

    assert.notStrictEqual(key1, key2, 'Different users with same resumeId must not produce identical key');
    assert.notStrictEqual(key1, key3, 'Same user with different resumeId must not produce identical key');
    assert.notStrictEqual(key2, key3, 'Different users and different resumes must not produce identical key');
  });

  // Test 2: Active lock immediately returns HTTP 409 Conflict
  await runTest('Test 2 — Active in-flight lock synchronously returns 409 Conflict', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    _activeAnalyses.add(lockKey);

    const req = { userId, params: { id: resumeId } };
    const res = createMockResponse();

    await analyzeResume(req, res, () => {});

    assert.strictEqual(res.statusCode, 409, 'Expected 409 Conflict when lock is active');
    assert.strictEqual(res.body?.message, 'Analysis already in progress for this resume');

    _activeAnalyses.delete(lockKey);
  });

  // Test 3: Lock is released on validation error / early return (400)
  await runTest('Test 3 — Lock is released in finally block on invalid resume ID format (400)', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const invalidId = 'not-hex';
    const lockKey = JSON.stringify([userId, invalidId]);

    const req = { userId, params: { id: invalidId } };
    const res = createMockResponse();

    await analyzeResume(req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released after 400 return');
  });

  // Test 4: Lock is released when resume is not found (404)
  await runTest('Test 4 — Lock is released in finally block when resume is not found (404)', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    const originalFindOne = Resume.findOne;
    Resume.findOne = async () => null;

    try {
      const req = { userId, params: { id: resumeId } };
      const res = createMockResponse();

      await analyzeResume(req, res, () => {});

      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released after 404 return');
    } finally {
      Resume.findOne = originalFindOne;
    }
  });

  // Test 5: Lock is released when resume has no uploaded file (400)
  await runTest('Test 5 — Lock is released in finally block when resume has no uploaded file (400)', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    const originalFindOne = Resume.findOne;
    Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: '' });

    try {
      const req = { userId, params: { id: resumeId } };
      const res = createMockResponse();

      await analyzeResume(req, res, () => {});

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body?.message, 'Resume does not have an uploaded file to analyze');
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released after 400 return');
    } finally {
      Resume.findOne = originalFindOne;
    }
  });

  // Test 6: Lock is released when PDF extraction fails (422)
  await runTest('Test 6 — Lock is released in finally block when PDF extraction throws EMPTY_TEXT (422)', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    const originalFindOne = Resume.findOne;
    const originalExtract = pdfService.extractTextFromPdf;

    Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: 'valid_pub_id' });
    pdfService.extractTextFromPdf = async () => {
      const err = new Error('Empty');
      err.code = 'EMPTY_TEXT';
      throw err;
    };

    try {
      const req = { userId, params: { id: resumeId } };
      const res = createMockResponse();

      await analyzeResume(req, res, () => {});

      assert.strictEqual(res.statusCode, 422);
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released after PDF extract error');
    } finally {
      Resume.findOne = originalFindOne;
      pdfService.extractTextFromPdf = originalExtract;
    }
  });

  // Test 7: Lock is released when AI service fails (502)
  await runTest('Test 7 — Lock is released in finally block when AI service fails (502)', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    const originalFindOne = Resume.findOne;
    const originalExtract = pdfService.extractTextFromPdf;
    const originalAi = aiService.analyzeResume;

    Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: 'valid_pub_id' });
    pdfService.extractTextFromPdf = async () => 'Valid resume text content';
    aiService.analyzeResume = async () => {
      const err = new Error('Unavailable');
      err.code = 'AI_API_ERROR';
      err.statusCode = 502;
      throw err;
    };

    try {
      const req = { userId, params: { id: resumeId } };
      const res = createMockResponse();

      await analyzeResume(req, res, () => {});

      assert.strictEqual(res.statusCode, 502);
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released after AI service failure');
    } finally {
      Resume.findOne = originalFindOne;
      pdfService.extractTextFromPdf = originalExtract;
      aiService.analyzeResume = originalAi;
    }
  });

  // Test 8: Lock is released on successful analysis (200) and allows subsequent analysis
  await runTest('Test 8 — Lock is released on success (200) and allows subsequent analysis of same resume', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    const mockResumeDoc = {
      _id: resumeId,
      userId,
      resumePublicId: 'valid_pub_id',
      feedback: {},
      save: async () => {},
    };

    const originalFindOne = Resume.findOne;
    const originalExtract = pdfService.extractTextFromPdf;
    const originalAi = aiService.analyzeResume;

    Resume.findOne = async () => mockResumeDoc;
    pdfService.extractTextFromPdf = async () => 'Valid resume text content';
    aiService.analyzeResume = async () => ({ score: 85, overallScore: 85 });

    try {
      const req1 = { userId, params: { id: resumeId } };
      const res1 = createMockResponse();

      await analyzeResume(req1, res1, () => {});

      assert.strictEqual(res1.statusCode, 200);
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be deleted after success');

      // Subsequent call for same resume succeeds
      const req2 = { userId, params: { id: resumeId } };
      const res2 = createMockResponse();

      await analyzeResume(req2, res2, () => {});

      assert.strictEqual(res2.statusCode, 200, 'Subsequent analysis must succeed');
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be deleted again after subsequent success');
    } finally {
      Resume.findOne = originalFindOne;
      pdfService.extractTextFromPdf = originalExtract;
      aiService.analyzeResume = originalAi;
    }
  });

  // Test 9: Concurrent execution — second simultaneous call receives 409
  await runTest('Test 9 — Second simultaneous call for same resume receives 409 Conflict while first is in-flight', async () => {
    const userId = '507f1f77bcf86cd799439011';
    const resumeId = '507f191e810c19729de860ea';
    const lockKey = JSON.stringify([userId, resumeId]);

    let resolveInFlight;
    const inFlightPromise = new Promise((resolve) => {
      resolveInFlight = resolve;
    });

    const mockResumeDoc = {
      _id: resumeId,
      userId,
      resumePublicId: 'valid_pub_id',
      feedback: {},
      save: async () => {},
    };

    const originalFindOne = Resume.findOne;
    const originalExtract = pdfService.extractTextFromPdf;
    const originalAi = aiService.analyzeResume;

    Resume.findOne = async () => mockResumeDoc;
    pdfService.extractTextFromPdf = async () => {
      // Hold in-flight state until resolveInFlight is called
      await inFlightPromise;
      return 'Valid resume text content';
    };
    aiService.analyzeResume = async () => ({ score: 90, overallScore: 90 });

    try {
      const req1 = { userId, params: { id: resumeId } };
      const res1 = createMockResponse();

      // Launch request 1 (starts in-flight asynchronous extraction)
      const call1Promise = analyzeResume(req1, res1, () => {});

      // Verify lockKey is actively held
      assert.strictEqual(_activeAnalyses.has(lockKey), true, 'Lock must be held while request 1 is in-flight');

      // Launch request 2 for identical (userId, resumeId)
      const req2 = { userId, params: { id: resumeId } };
      const res2 = createMockResponse();
      await analyzeResume(req2, res2, () => {});

      assert.strictEqual(res2.statusCode, 409, 'Request 2 must receive 409 Conflict');
      assert.strictEqual(res2.body?.message, 'Analysis already in progress for this resume');

      // Now allow request 1 to complete
      resolveInFlight();
      await call1Promise;

      assert.strictEqual(res1.statusCode, 200, 'Request 1 must finish successfully with 200');
      assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released once request 1 completes');
    } finally {
      Resume.findOne = originalFindOne;
      pdfService.extractTextFromPdf = originalExtract;
      aiService.analyzeResume = originalAi;
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
