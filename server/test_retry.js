const assert = require('assert');
const aiService = require('./services/aiService');

const sampleFeedback = {
  overallScore: 85,
  ATS: {
    score: 88,
    tips: [
      { type: 'good', tip: 'Standard headings used throughout' },
      { type: 'improve', tip: 'Incorporate additional keywords from job description' },
    ],
  },
  toneAndStyle: {
    score: 82,
    tips: [
      {
        type: 'good',
        tip: 'Action-oriented language',
        explanation: 'Bullet points begin with strong verbs like Spearheaded and Designed.',
      },
    ],
  },
  content: {
    score: 86,
    tips: [
      {
        type: 'good',
        tip: 'Quantified business impact',
        explanation: 'Included metrics such as 30% reduction in API response times.',
      },
    ],
  },
  structure: {
    score: 84,
    tips: [
      {
        type: 'good',
        tip: 'Logical layout',
        explanation: 'Chronological order clearly demonstrates career progression.',
      },
    ],
  },
  skills: {
    score: 90,
    tips: [
      {
        type: 'good',
        tip: 'Relevant technical stack',
        explanation: 'Directly mentions required tools like Node.js, React, and MongoDB.',
      },
    ],
  },
};

const mockValidResponse = {
  text: JSON.stringify(sampleFeedback),
};

const testParams = {
  resumeText: 'Jane Doe Software Engineer Experience at Acme Corp...',
  companyName: 'Acme Corp',
  jobTitle: 'Senior Software Engineer',
  jobDescription: 'Seeking backend developer experienced in Node.js and APIs.',
};

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

(async () => {
  console.log('====================================================');
  console.log('Section 7: Gemini AI Transient Error Retry Tests');
  console.log('====================================================\n');

  // Test 1: Immediate Success
  await runTest('Test 1 — Immediate success on first attempt', async () => {
    let callCount = 0;
    const delays = [];

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          return mockValidResponse;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const result = await aiService.analyzeResume(testParams, {
      client: mockClient,
      sleep,
    });

    assert.strictEqual(callCount, 1, 'Expected exactly 1 Gemini API call');
    assert.strictEqual(delays.length, 0, 'Expected 0 backoff delays on immediate success');
    assert.strictEqual(result.overallScore, 85, 'Expected validated overallScore');
    assert.strictEqual(result.ATS.score, 88, 'Expected validated ATS score');
  });

  // Test 2: Transient failure (503) then success on attempt 2
  await runTest('Test 2 — Transient failure (503 UNAVAILABLE) then success on retry', async () => {
    let callCount = 0;
    const delays = [];

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error(
              JSON.stringify({
                error: {
                  code: 503,
                  message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
                  status: 'UNAVAILABLE',
                },
              })
            );
            err.status = 503;
            throw err;
          }
          return mockValidResponse;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const result = await aiService.analyzeResume(testParams, {
      client: mockClient,
      sleep,
    });

    assert.strictEqual(callCount, 2, 'Expected exactly 2 Gemini API calls (initial + 1 retry)');
    assert.strictEqual(delays.length, 1, 'Expected exactly 1 backoff sleep before retry');
    assert.ok(delays[0] >= 1000 && delays[0] <= 1250, `Expected delay between 1000-1250ms, got ${delays[0]}ms`);
    assert.strictEqual(result.overallScore, 85, 'Expected validated overallScore after retry');
  });

  // Test 3: Multiple transient failures (503 -> 429) then success on attempt 3
  await runTest('Test 3 — Multiple transient failures (503 then 429) then success on attempt 3', async () => {
    let callCount = 0;
    const delays = [];

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('503 Service Unavailable');
            err.status = 503;
            throw err;
          }
          if (callCount === 2) {
            const err = new Error(
              JSON.stringify({
                error: {
                  code: 429,
                  message: 'Rate limit exceeded.',
                  status: 'RESOURCE_EXHAUSTED',
                },
              })
            );
            err.status = 429;
            throw err;
          }
          return mockValidResponse;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const result = await aiService.analyzeResume(testParams, {
      client: mockClient,
      sleep,
    });

    assert.strictEqual(callCount, 3, 'Expected exactly 3 Gemini API calls (initial + 2 retries)');
    assert.strictEqual(delays.length, 2, 'Expected exactly 2 backoff sleeps before eventual success');
    assert.ok(delays[0] >= 1000 && delays[0] <= 1250, `Delay 1 should be 1000-1250ms, got ${delays[0]}ms`);
    assert.ok(delays[1] >= 2000 && delays[1] <= 2250, `Delay 2 should be 2000-2250ms, got ${delays[1]}ms`);
    assert.ok(delays[1] > delays[0], 'Expected exponential backoff increase from delay 1 to delay 2');
    assert.strictEqual(result.overallScore, 85, 'Expected validated overallScore after 2 retries');
  });

  // Test 4: Retry exhaustion after 3 attempts
  await runTest('Test 4 — Retry exhaustion after 3 failed attempts (503 UNAVAILABLE)', async () => {
    let callCount = 0;
    const delays = [];
    const simulatedErrorMsg =
      '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}';

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          const err = new Error(simulatedErrorMsg);
          err.status = 503;
          throw err;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    let caughtError = null;
    try {
      await aiService.analyzeResume(testParams, {
        client: mockClient,
        sleep,
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected analyzeResume to throw an error after exhausting retries');
    assert.strictEqual(callCount, 3, 'Expected exactly 3 attempts and no fourth attempt');
    assert.strictEqual(delays.length, 2, 'Expected 2 backoff sleeps across 3 attempts');
    assert.strictEqual(caughtError.code, 'AI_API_ERROR', 'Expected error.code to be AI_API_ERROR');
    assert.strictEqual(caughtError.statusCode, 502, 'Expected error.statusCode to be 502');
    assert.strictEqual(
      caughtError.originalMessage,
      simulatedErrorMsg,
      'Expected originalMessage to preserve the underlying Gemini 503 error'
    );
  });

  // Test 5: Permanent error (400 or 403) fails immediately without retry
  await runTest('Test 5 — Permanent error (403 PERMISSION_DENIED) fails immediately without retry', async () => {
    let callCount = 0;
    const delays = [];
    const simulatedPermError =
      '{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}';

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          const err = new Error(simulatedPermError);
          err.status = 403;
          throw err;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    let caughtError = null;
    try {
      await aiService.analyzeResume(testParams, {
        client: mockClient,
        sleep,
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Expected analyzeResume to throw for permanent 403 error');
    assert.strictEqual(callCount, 1, 'Expected exactly 1 API call (aborted immediately, 0 retries)');
    assert.strictEqual(delays.length, 0, 'Expected 0 backoff delays for non-retryable error');
    assert.strictEqual(caughtError.code, 'AI_API_ERROR', 'Expected error.code to be AI_API_ERROR');
    assert.strictEqual(caughtError.statusCode, 502, 'Expected error.statusCode to be 502');
    assert.strictEqual(
      caughtError.originalMessage,
      simulatedPermError,
      'Expected originalMessage to preserve underlying 403 error'
    );
  });

  // Test 6: Output structure and schema validation integrity
  await runTest('Test 6 — Output structure and schema validation preserved after retry', async () => {
    let callCount = 0;
    const delays = [];

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('504 Gateway Timeout');
            err.status = 504;
            throw err;
          }
          return mockValidResponse;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const feedback = await aiService.analyzeResume(testParams, {
      client: mockClient,
      sleep,
    });

    assert.strictEqual(callCount, 2, 'Expected retry to succeed on call 2');
    assert.strictEqual(typeof feedback.overallScore, 'number', 'overallScore must be a number');
    assert.ok(feedback.overallScore >= 0 && feedback.overallScore <= 100, 'overallScore in [0, 100]');

    // Validate all required categories exist
    const categories = ['ATS', 'toneAndStyle', 'content', 'structure', 'skills'];
    for (const cat of categories) {
      assert.ok(feedback[cat], `Feedback category ${cat} must exist`);
      assert.strictEqual(typeof feedback[cat].score, 'number', `${cat}.score must be a number`);
      assert.ok(feedback[cat].score >= 0 && feedback[cat].score <= 100, `${cat}.score in [0, 100]`);
      assert.ok(Array.isArray(feedback[cat].tips), `${cat}.tips must be an array`);
      assert.ok(feedback[cat].tips.length > 0, `${cat}.tips must not be empty`);
    }

    // Validate detailed explanation requirements
    const detailedCategories = ['toneAndStyle', 'content', 'structure', 'skills'];
    for (const cat of detailedCategories) {
      for (const tip of feedback[cat].tips) {
        assert.ok(['good', 'improve'].includes(tip.type), `${cat} tip.type must be good or improve`);
        assert.ok(typeof tip.tip === 'string' && tip.tip.trim(), `${cat} tip.tip must be non-empty string`);
        assert.ok(
          typeof tip.explanation === 'string' && tip.explanation.trim(),
          `${cat} tip.explanation must be non-empty string`
        );
      }
    }
  });

  // Additional check: Transient Network Error (fetch failed / ECONNRESET)
  await runTest('Test 7 (Bonus) — Transient network error (fetch failed) retries and succeeds', async () => {
    let callCount = 0;
    const delays = [];

    const mockClient = {
      models: {
        generateContent: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new TypeError('fetch failed');
            err.cause = { code: 'ECONNRESET' };
            throw err;
          }
          return mockValidResponse;
        },
      },
    };

    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };

    const result = await aiService.analyzeResume(testParams, {
      client: mockClient,
      sleep,
    });

    assert.strictEqual(callCount, 2, 'Expected network error to trigger retry and succeed on attempt 2');
    assert.strictEqual(delays.length, 1, 'Expected 1 backoff delay');
    assert.strictEqual(result.overallScore, 85, 'Expected valid result');
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
