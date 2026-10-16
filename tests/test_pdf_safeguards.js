const path = require('path');
// Ensure dependencies installed in server/node_modules are resolvable when run from tests/
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const { analyzeResume, _activeAnalyses } = require('../server/controllers/resumeController');
const Resume = require('../server/models/Resume');
const pdfService = require('../server/services/pdfService');
const cloudinaryService = require('../server/services/cloudinaryService');
const aiService = require('../server/services/aiService');
const { PDFParse } = require('pdf-parse');

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
  console.log('Step 1.4 — Phase 3: Defensive PDF & Text Bound Tests');
  console.log('====================================================\n');

  const originalFetch = global.fetch;
  const originalGenerateSignedUrl = cloudinaryService.generateSignedUrl;

  try {
    // ----------------------------------------------------
    // Section 1: PDF Service Unit Tests
    // ----------------------------------------------------

    // Test 1: Fetch options include an AbortSignal
    await runTest('Test 1 — Cloudinary fetch receives an AbortSignal timeout', async () => {
      let passedSignal = null;
      cloudinaryService.generateSignedUrl = () => 'https://res.cloudinary.com/mock/signed/url.pdf';
      global.fetch = async (url, options) => {
        passedSignal = options?.signal;
        // Return dummy valid response
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from('%PDF-1.4 sample'),
        };
      };

      // Stub PDFParse to prevent parsing the dummy buffer
      const originalPDFParse = PDFParse.prototype.getText;
      PDFParse.prototype.getText = async () => ({ text: 'Sample resume text' });

      try {
        await pdfService.extractTextFromPdf('test_pub_id_1');
        assert(passedSignal instanceof AbortSignal, 'Expected AbortSignal instance to be passed to fetch');
      } finally {
        PDFParse.prototype.getText = originalPDFParse;
      }
    });

    // Test 2: TimeoutError maps to DOWNLOAD_TIMEOUT and redacts secrets
    await runTest('Test 2 — Fetch TimeoutError throws DOWNLOAD_TIMEOUT with redacted error details', async () => {
      cloudinaryService.generateSignedUrl = () =>
        'https://res.cloudinary.com/mock/signed/url.pdf?api_key=SECRET_KEY&signature=SECRET_SIG';

      global.fetch = async () => {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      };

      let thrownErr = null;
      try {
        await pdfService.extractTextFromPdf('test_pub_id_timeout');
      } catch (err) {
        thrownErr = err;
      }

      assert(thrownErr, 'Expected error to be thrown');
      assert.strictEqual(thrownErr.code, 'DOWNLOAD_TIMEOUT');
      assert.strictEqual(thrownErr.message, 'Timed out downloading resume from storage');
      assert.strictEqual(thrownErr.details, 'Storage download timeout');
      assert(!JSON.stringify(thrownErr).includes('SECRET_KEY'), 'Must not leak SECRET_KEY in error object');
      assert(!JSON.stringify(thrownErr).includes('SECRET_SIG'), 'Must not leak SECRET_SIG in error object');
    });

    // Test 3: AbortError maps to DOWNLOAD_TIMEOUT
    await runTest('Test 3 — Fetch AbortError throws DOWNLOAD_TIMEOUT', async () => {
      cloudinaryService.generateSignedUrl = () => 'https://res.cloudinary.com/mock/signed/url.pdf';

      global.fetch = async () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      };

      let thrownErr = null;
      try {
        await pdfService.extractTextFromPdf('test_pub_id_abort');
      } catch (err) {
        thrownErr = err;
      }

      assert(thrownErr, 'Expected error to be thrown');
      assert.strictEqual(thrownErr.code, 'DOWNLOAD_TIMEOUT');
      assert.strictEqual(thrownErr.details, 'Storage download timeout');
    });

    // Test 4: Generic network error does NOT leak signed URL or credentials in details
    await runTest('Test 4 — Generic network error details are sanitized and do not leak query secrets', async () => {
      const secretUrl = 'https://res.cloudinary.com/demo/image/upload/s--SECRET123--/v1/resume.pdf?sig=TOP_SECRET';
      cloudinaryService.generateSignedUrl = () => secretUrl;

      global.fetch = async () => {
        const networkErr = new Error(`fetch failed: ${secretUrl}`);
        throw networkErr;
      };

      let thrownErr = null;
      try {
        await pdfService.extractTextFromPdf('test_pub_id_secret_leak');
      } catch (err) {
        thrownErr = err;
      }

      assert(thrownErr, 'Expected error to be thrown');
      assert.strictEqual(thrownErr.code, 'FILE_READ_ERROR');
      assert.strictEqual(thrownErr.details, 'Storage read error');
      assert(!thrownErr.details.includes('TOP_SECRET'), 'err.details must not contain secret signature');
      assert(!thrownErr.details.includes('SECRET123'), 'err.details must not contain secret path');
    });

    // Test 5: Exactly 50,000 characters is accepted
    await runTest('Test 5 — Exactly 50,000 extracted characters is accepted without truncation', async () => {
      cloudinaryService.generateSignedUrl = () => 'https://res.cloudinary.com/mock/signed/url.pdf';
      global.fetch = async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from('%PDF-1.4 test'),
      });

      const exact50k = 'A'.repeat(50000);
      const originalPDFParse = PDFParse.prototype.getText;
      PDFParse.prototype.getText = async () => ({ text: exact50k });

      try {
        const result = await pdfService.extractTextFromPdf('test_pub_id_exact_50k');
        assert.strictEqual(result.length, 50000);
        assert.strictEqual(result, exact50k);
      } finally {
        PDFParse.prototype.getText = originalPDFParse;
      }
    });

    // Test 6: 50,001 characters throws TEXT_TOO_LONG
    await runTest('Test 6 — 50,001 extracted characters throws TEXT_TOO_LONG before AI call', async () => {
      cloudinaryService.generateSignedUrl = () => 'https://res.cloudinary.com/mock/signed/url.pdf';
      global.fetch = async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from('%PDF-1.4 test'),
      });

      const over50k = 'B'.repeat(50001);
      const originalPDFParse = PDFParse.prototype.getText;
      PDFParse.prototype.getText = async () => ({ text: over50k });

      let thrownErr = null;
      try {
        await pdfService.extractTextFromPdf('test_pub_id_over_50k');
      } catch (err) {
        thrownErr = err;
      } finally {
        PDFParse.prototype.getText = originalPDFParse;
      }

      assert(thrownErr, 'Expected TEXT_TOO_LONG error to be thrown');
      assert.strictEqual(thrownErr.code, 'TEXT_TOO_LONG');
      assert.strictEqual(thrownErr.message, 'Resume text exceeds maximum allowed length of 50,000 characters');
    });

    // ----------------------------------------------------
    // Section 2: Controller Error Mapping & Concurrency Release Tests
    // ----------------------------------------------------

    // Test 7: DOWNLOAD_TIMEOUT returns HTTP 504 and releases concurrency lock
    await runTest('Test 7 — DOWNLOAD_TIMEOUT maps to HTTP 504 and releases concurrency lock', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const resumeId = '507f191e810c19729de860ea';
      const lockKey = JSON.stringify([userId, resumeId]);

      const originalFindOne = Resume.findOne;
      const originalExtract = pdfService.extractTextFromPdf;

      Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: 'valid_pub_id' });
      pdfService.extractTextFromPdf = async () => {
        const err = new Error('Timed out downloading resume from storage');
        err.code = 'DOWNLOAD_TIMEOUT';
        throw err;
      };

      try {
        const req = { userId, params: { id: resumeId } };
        const res = createMockResponse();

        await analyzeResume(req, res, () => {});

        assert.strictEqual(res.statusCode, 504);
        assert.strictEqual(res.body?.message, 'Timed out retrieving resume from storage');
        assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released on 504 timeout');
      } finally {
        Resume.findOne = originalFindOne;
        pdfService.extractTextFromPdf = originalExtract;
      }
    });

    // Test 8: TEXT_TOO_LONG maps to HTTP 400, asserts Gemini not called, and releases lock
    await runTest('Test 8 — TEXT_TOO_LONG maps to HTTP 400, does NOT call Gemini, and releases lock', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const resumeId = '507f191e810c19729de860ea';
      const lockKey = JSON.stringify([userId, resumeId]);

      let geminiCallCount = 0;
      const originalFindOne = Resume.findOne;
      const originalExtract = pdfService.extractTextFromPdf;
      const originalAi = aiService.analyzeResume;

      Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: 'valid_pub_id' });
      pdfService.extractTextFromPdf = async () => {
        const err = new Error('Resume text exceeds maximum allowed length of 50,000 characters');
        err.code = 'TEXT_TOO_LONG';
        throw err;
      };
      aiService.analyzeResume = async () => {
        geminiCallCount++;
        return { score: 90 };
      };

      try {
        const req = { userId, params: { id: resumeId } };
        const res = createMockResponse();

        await analyzeResume(req, res, () => {});

        assert.strictEqual(res.statusCode, 400);
        assert.strictEqual(res.body?.message, 'Resume text exceeds maximum allowed length of 50,000 characters');
        assert.strictEqual(geminiCallCount, 0, 'Gemini must not be called when text length exceeds limit');
        assert.strictEqual(_activeAnalyses.has(lockKey), false, 'Lock must be released on 400 TEXT_TOO_LONG');
      } finally {
        Resume.findOne = originalFindOne;
        pdfService.extractTextFromPdf = originalExtract;
        aiService.analyzeResume = originalAi;
      }
    });

    // Test 9: Existing PDF error mappings remain intact
    await runTest('Test 9 — Existing PDF error mappings (FILE_NOT_FOUND, EMPTY_TEXT, CORRUPTED_PDF) remain intact', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const resumeId = '507f191e810c19729de860ea';

      const originalFindOne = Resume.findOne;
      const originalExtract = pdfService.extractTextFromPdf;

      Resume.findOne = async () => ({ _id: resumeId, userId, resumePublicId: 'valid_pub_id' });

      try {
        // Sub-case A: FILE_NOT_FOUND -> 404
        pdfService.extractTextFromPdf = async () => {
          const err = new Error('Not found');
          err.code = 'FILE_NOT_FOUND';
          throw err;
        };
        const resA = createMockResponse();
        await analyzeResume({ userId, params: { id: resumeId } }, resA, () => {});
        assert.strictEqual(resA.statusCode, 404);
        assert.strictEqual(resA.body?.message, 'Stored resume file not found on server');

        // Sub-case B: EMPTY_TEXT -> 422
        pdfService.extractTextFromPdf = async () => {
          const err = new Error('Empty');
          err.code = 'EMPTY_TEXT';
          throw err;
        };
        const resB = createMockResponse();
        await analyzeResume({ userId, params: { id: resumeId } }, resB, () => {});
        assert.strictEqual(resB.statusCode, 422);
        assert.strictEqual(resB.body?.message, 'Resume PDF does not contain extractable text');

        // Sub-case C: CORRUPTED_PDF -> 400
        pdfService.extractTextFromPdf = async () => {
          const err = new Error('Corrupt');
          err.code = 'CORRUPTED_PDF';
          throw err;
        };
        const resC = createMockResponse();
        await analyzeResume({ userId, params: { id: resumeId } }, resC, () => {});
        assert.strictEqual(resC.statusCode, 400);
        assert.strictEqual(resC.body?.message, 'Failed to extract text from resume PDF');
      } finally {
        Resume.findOne = originalFindOne;
        pdfService.extractTextFromPdf = originalExtract;
      }
    });

    // Test 10: After 504 timeout or 400 text-limit rejection, subsequent request is not locked
    await runTest('Test 10 — Subsequent request for same resume succeeds after previous timeout/length rejection', async () => {
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

      let failWithTimeout = true;
      const originalFindOne = Resume.findOne;
      const originalExtract = pdfService.extractTextFromPdf;
      const originalAi = aiService.analyzeResume;

      Resume.findOne = async () => mockResumeDoc;
      pdfService.extractTextFromPdf = async () => {
        if (failWithTimeout) {
          const err = new Error('Timeout');
          err.code = 'DOWNLOAD_TIMEOUT';
          throw err;
        }
        return 'Valid 50k text';
      };
      aiService.analyzeResume = async () => ({ score: 88, overallScore: 88 });

      try {
        // Attempt 1: times out
        const res1 = createMockResponse();
        await analyzeResume({ userId, params: { id: resumeId } }, res1, () => {});
        assert.strictEqual(res1.statusCode, 504);
        assert.strictEqual(_activeAnalyses.has(lockKey), false);

        // Attempt 2: recovers and succeeds
        failWithTimeout = false;
        const res2 = createMockResponse();
        await analyzeResume({ userId, params: { id: resumeId } }, res2, () => {});
        assert.strictEqual(res2.statusCode, 200);
        assert.strictEqual(_activeAnalyses.has(lockKey), false);
      } finally {
        Resume.findOne = originalFindOne;
        pdfService.extractTextFromPdf = originalExtract;
        aiService.analyzeResume = originalAi;
      }
    });

  } finally {
    global.fetch = originalFetch;
    cloudinaryService.generateSignedUrl = originalGenerateSignedUrl;
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
