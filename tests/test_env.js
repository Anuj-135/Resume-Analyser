const path = require('path');
module.paths.push(path.resolve(__dirname, '../server/node_modules'));

const assert = require('assert');
const { parseEnv, validateEnv, cleanEnvObject } = require('../server/config/env');

let passedCount = 0;
let failedCount = 0;

const runTest = (name, testFn) => {
  try {
    testFn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(err);
    failedCount++;
  }
};

const validDevEnv = {
  NODE_ENV: 'development',
  PORT: '5000',
  MONGODB_URI: 'mongodb://localhost:27017/resume-analyser-test',
  CLIENT_URL: 'http://localhost:3000',
  JWT_SECRET: 'dev-jwt-secret-with-sufficient-length',
  JWT_EXPIRES_IN: '7d',
  GEMINI_API_KEY: 'test-dev-gemini-key',
  CLOUDINARY_CLOUD_NAME: 'placeholder',
  CLOUDINARY_API_KEY: 'placeholder',
  CLOUDINARY_API_SECRET: 'placeholder',
};

const validProdEnv = {
  NODE_ENV: 'production',
  PORT: '10000',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.mongodb.net/resume-prod?retryWrites=true&w=majority',
  CLIENT_URL: 'https://resume-analyser-sooty-delta.vercel.app',
  JWT_SECRET: 'a_very_strong_production_jwt_secret_with_at_least_32_characters_12345',
  JWT_EXPIRES_IN: '7d',
  GEMINI_API_KEY: 'valid-gemini-production-api-key',
  GEMINI_MODEL: 'gemini-3.8-flash',
  CLOUDINARY_CLOUD_NAME: 'real-cloud-name',
  CLOUDINARY_API_KEY: 'real-api-key',
  CLOUDINARY_API_SECRET: 'real-api-secret',
};

console.log('====================================================');
console.log('Step 1.1: Environment & Startup Validation Tests');
console.log('====================================================\n');

// Test 1: Valid development configuration
runTest('Test 1 — Valid development configuration is accepted with defaults', () => {
  const result = parseEnv(validDevEnv);
  assert.strictEqual(result.success, true, 'Expected valid dev env to succeed');
  assert.strictEqual(result.data.NODE_ENV, 'development');
  assert.strictEqual(result.data.PORT, 5000);
  assert.strictEqual(result.data.GEMINI_MODEL, 'gemini-3.8-flash');
  assert.strictEqual(result.data.JWT_EXPIRES_IN, '7d');
});

// Test 2: Valid production configuration
runTest('Test 2 — Valid production configuration is accepted', () => {
  const result = parseEnv(validProdEnv);
  assert.strictEqual(result.success, true, 'Expected valid prod env to succeed');
  assert.strictEqual(result.data.NODE_ENV, 'production');
  assert.strictEqual(result.data.PORT, 10000);
  assert.strictEqual(result.data.CLIENT_URL, 'https://resume-analyser-sooty-delta.vercel.app');
});

// Test 3: Missing MONGODB_URI is rejected
runTest('Test 3 — Missing MONGODB_URI is rejected with clear error', () => {
  const badEnv = { ...validDevEnv };
  delete badEnv.MONGODB_URI;
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'MONGODB_URI');
  assert.ok(error, 'Expected error for MONGODB_URI');
  assert.ok(error.message.includes('required'), 'Expected required message');
});

// Test 4: Missing JWT_SECRET is rejected
runTest('Test 4 — Missing JWT_SECRET is rejected with clear error', () => {
  const badEnv = { ...validDevEnv };
  delete badEnv.JWT_SECRET;
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'JWT_SECRET');
  assert.ok(error, 'Expected error for JWT_SECRET');
  assert.ok(error.message.includes('required'), 'Expected required message');
});

// Test 5: Weak JWT secret in production (< 32 chars) is rejected
runTest('Test 5 — Weak production JWT secret (< 32 chars) is rejected', () => {
  const weakSecret = 'too-short-secret';
  const badEnv = {
    ...validProdEnv,
    JWT_SECRET: weakSecret,
  };
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'JWT_SECRET');
  assert.ok(error, 'Expected error for JWT_SECRET');
  assert.ok(error.message.includes('at least 32 characters long in production'));
  // Ensure the actual secret value is NEVER leaked in the error message
  assert.strictEqual(error.message.includes(weakSecret), false, 'Error message must NOT leak secret value');
});

// Test 6: Permissive JWT secret in development (e.g. 16 chars) is accepted
runTest('Test 6 — Reasonable development JWT secret (>= 8 chars) is accepted in dev', () => {
  const devEnv = {
    ...validDevEnv,
    JWT_SECRET: 'dev-secret-16ch',
  };
  const result = parseEnv(devEnv);
  assert.strictEqual(result.success, true);
});

// Test 7: Invalid NODE_ENV value is rejected
runTest('Test 7 — Invalid NODE_ENV values are rejected', () => {
  const badEnv = {
    ...validDevEnv,
    NODE_ENV: 'staging',
  };
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'NODE_ENV');
  assert.ok(error, 'Expected error for NODE_ENV');
  assert.ok(error.message.includes('must be one of'));
});

// Test 8: Invalid MONGODB_URI protocol is rejected
runTest('Test 8 — Non-MongoDB URI protocol is rejected', () => {
  const badEnv = {
    ...validDevEnv,
    MONGODB_URI: 'postgres://user:pass@localhost:5432/db',
  };
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'MONGODB_URI');
  assert.ok(error, 'Expected error for invalid MONGODB_URI');
  assert.ok(error.message.includes('starting with mongodb:// or mongodb+srv://'));
});

// Test 9: Invalid CLIENT_URL is rejected
runTest('Test 9 — Invalid CLIENT_URL format is rejected', () => {
  const badEnv = {
    ...validDevEnv,
    CLIENT_URL: 'not-a-valid-url-format',
  };
  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false);
  const error = result.errors.find((e) => e.field === 'CLIENT_URL');
  assert.ok(error, 'Expected error for invalid CLIENT_URL');
  assert.ok(error.message.includes('valid URL string'));
});

// Test 10: Invalid PORT value is rejected
runTest('Test 10 — Invalid PORT (out of range or non-number) is rejected', () => {
  const badEnv1 = { ...validDevEnv, PORT: 'abc' };
  const res1 = parseEnv(badEnv1);
  assert.strictEqual(res1.success, false);
  assert.ok(res1.errors.some((e) => e.field === 'PORT'));

  const badEnv2 = { ...validDevEnv, PORT: '70000' };
  const res2 = parseEnv(badEnv2);
  assert.strictEqual(res2.success, false);
  assert.ok(res2.errors.some((e) => e.field === 'PORT'));
});

// Test 11: Production rejects missing Gemini API key and placeholder Cloudinary credentials
runTest('Test 11 — Production rejects missing Gemini key and placeholder Cloudinary credentials', () => {
  const badProd = {
    ...validProdEnv,
    GEMINI_API_KEY: '',
    CLOUDINARY_CLOUD_NAME: 'placeholder',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: 'placeholder',
  };
  const result = parseEnv(badProd);
  assert.strictEqual(result.success, false);
  const fields = result.errors.map((e) => e.field);
  assert.ok(fields.includes('GEMINI_API_KEY'), 'Missing GEMINI_API_KEY should be flagged in prod');
  assert.ok(fields.includes('CLOUDINARY_CLOUD_NAME'), 'Placeholder CLOUDINARY_CLOUD_NAME should be flagged in prod');
  assert.ok(fields.includes('CLOUDINARY_API_KEY'), 'Empty CLOUDINARY_API_KEY should be flagged in prod');
  assert.ok(fields.includes('CLOUDINARY_API_SECRET'), 'Placeholder CLOUDINARY_API_SECRET should be flagged in prod');
});

// Test 12: Development accepts placeholder Cloudinary credentials without error
runTest('Test 12 — Development accepts placeholder Cloudinary credentials', () => {
  const devEnv = {
    ...validDevEnv,
    CLOUDINARY_CLOUD_NAME: 'placeholder',
    CLOUDINARY_API_KEY: 'placeholder',
    CLOUDINARY_API_SECRET: 'placeholder',
  };
  const result = parseEnv(devEnv);
  assert.strictEqual(result.success, true, 'Development mode should permit placeholder Cloudinary config');
});

// Test 13: Whitespace and empty strings are cleaned and assigned defaults
runTest('Test 13 — Whitespace and empty strings are cleanly assigned defaults', () => {
  const envWithBlanks = {
    ...validDevEnv,
    PORT: '   ',
    JWT_EXPIRES_IN: '',
    GEMINI_MODEL: '   ',
  };
  const result = parseEnv(envWithBlanks);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.PORT, 5000);
  assert.strictEqual(result.data.JWT_EXPIRES_IN, '7d');
  assert.strictEqual(result.data.GEMINI_MODEL, 'gemini-3.8-flash');
});

// Test 14: validateEnv() throws error without exiting when exitOnError is false
runTest('Test 14 — validateEnv() throws structured error when exitOnError is false', () => {
  assert.throws(
    () => {
      validateEnv({}, { exitOnError: false });
    },
    (err) => {
      return err.message === 'Environment validation failed' && Array.isArray(err.errors);
    }
  );
});

// Test 15: Local environment with omitted NODE_ENV defaults to development
runTest('Test 15 — Local environment with omitted NODE_ENV defaults to "development"', () => {
  const localEnv = { ...validDevEnv };
  delete localEnv.NODE_ENV;
  const result = parseEnv(localEnv);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.NODE_ENV, 'development');
  assert.strictEqual(result.data.RENDER, false);
});

// Test 16: Local environment with empty NODE_ENV defaults to development
runTest('Test 16 — Local environment with empty NODE_ENV string defaults to "development"', () => {
  const localEnv = { ...validDevEnv, NODE_ENV: '   ' };
  const result = parseEnv(localEnv);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.NODE_ENV, 'development');
});

// Test 17: Render environment with omitted or empty NODE_ENV fails validation
runTest('Test 17 — Render environment with omitted or empty NODE_ENV fails validation', () => {
  // Case A: omitted NODE_ENV
  const renderOmitted = { ...validProdEnv, RENDER: 'true' };
  delete renderOmitted.NODE_ENV;
  const resOmitted = parseEnv(renderOmitted);
  assert.strictEqual(resOmitted.success, false);
  const errOmitted = resOmitted.errors.find((e) => e.field === 'NODE_ENV');
  assert.ok(errOmitted, 'Expected error on NODE_ENV for omitted value on Render');
  assert.ok(
    errOmitted.message.includes("NODE_ENV must be explicitly set to 'production' when running on Render"),
    'Expected Render-specific requirement message'
  );
  assert.ok(errOmitted.message.includes('currently missing or empty'));

  // Case B: empty string NODE_ENV
  const renderEmpty = { ...validProdEnv, RENDER: 'true', NODE_ENV: '   ' };
  const resEmpty = parseEnv(renderEmpty);
  assert.strictEqual(resEmpty.success, false);
  const errEmpty = resEmpty.errors.find((e) => e.field === 'NODE_ENV');
  assert.ok(errEmpty, 'Expected error on NODE_ENV for empty value on Render');
  assert.ok(errEmpty.message.includes('currently missing or empty'));
});

// Test 18: Render environment with NODE_ENV=development fails validation
runTest('Test 18 — Render environment with NODE_ENV=development fails validation', () => {
  const renderDev = { ...validProdEnv, RENDER: 'true', NODE_ENV: 'development' };
  const result = parseEnv(renderDev);
  assert.strictEqual(result.success, false);
  const err = result.errors.find((e) => e.field === 'NODE_ENV');
  assert.ok(err, 'Expected error on NODE_ENV for development on Render');
  assert.ok(
    err.message.includes("NODE_ENV must be explicitly set to 'production' when running on Render"),
    'Expected Render guard message'
  );
  assert.ok(err.message.includes("cannot be 'development'"));
});

// Test 19: Render environment with NODE_ENV=test fails validation
runTest('Test 19 — Render environment with NODE_ENV=test fails validation', () => {
  const renderTest = { ...validProdEnv, RENDER: 'true', NODE_ENV: 'test' };
  const result = parseEnv(renderTest);
  assert.strictEqual(result.success, false);
  const err = result.errors.find((e) => e.field === 'NODE_ENV');
  assert.ok(err, 'Expected error on NODE_ENV for test on Render');
  assert.ok(
    err.message.includes("NODE_ENV must be explicitly set to 'production' when running on Render"),
    'Expected Render guard message'
  );
  assert.ok(err.message.includes("cannot be 'test'"));
});

// Test 20: Render environment with explicit NODE_ENV=production passes this guard
runTest('Test 20 — Render environment with explicit NODE_ENV=production passes guard and prod checks', () => {
  const renderProd = { ...validProdEnv, RENDER: 'true', NODE_ENV: 'production' };
  const result = parseEnv(renderProd);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.NODE_ENV, 'production');
  assert.strictEqual(result.data.RENDER, true);
});

// Test 21: Existing valid local development and test configurations still pass
runTest('Test 21 — Existing valid local development and test configurations pass', () => {
  const devResult = parseEnv({ ...validDevEnv, NODE_ENV: 'development' });
  assert.strictEqual(devResult.success, true);
  assert.strictEqual(devResult.data.NODE_ENV, 'development');

  const testResult = parseEnv({ ...validDevEnv, NODE_ENV: 'test' });
  assert.strictEqual(testResult.success, true);
  assert.strictEqual(testResult.data.NODE_ENV, 'test');
});

// Test 22: Dummy GEMINI_API_KEY and CLOUDINARY_API_SECRET values are not reflected in validation errors
runTest('Test 22 — Dummy GEMINI_API_KEY and CLOUDINARY_API_SECRET values are not reflected in validation errors', () => {
  const dummyGemini = 'DUMMY_GEMINI_API_KEY_SECRET_VALUE_998877';
  const dummyCloudinarySecret = 'DUMMY_CLOUDINARY_API_SECRET_XYZ_443322';

  // Trigger validation errors across multiple fields in production mode with dummy secrets populated
  const badEnv = {
    NODE_ENV: 'production',
    PORT: 'invalid-port',
    MONGODB_URI: 'invalid-uri',
    JWT_SECRET: 'short',
    GEMINI_API_KEY: dummyGemini,
    CLOUDINARY_CLOUD_NAME: 'placeholder', // triggers error
    CLOUDINARY_API_KEY: 'valid-api-key',
    CLOUDINARY_API_SECRET: dummyCloudinarySecret,
  };

  const result = parseEnv(badEnv);
  assert.strictEqual(result.success, false, 'Expected validation failure');
  assert.ok(result.errors.length > 0, 'Expected errors');

  // Verify that neither secret string appears in any field or message of the error output
  const serializedErrors = JSON.stringify(result.errors);
  assert.strictEqual(
    serializedErrors.includes(dummyGemini),
    false,
    'Dummy GEMINI_API_KEY value must NEVER be leaked in validation errors'
  );
  assert.strictEqual(
    serializedErrors.includes(dummyCloudinarySecret),
    false,
    'Dummy CLOUDINARY_API_SECRET value must NEVER be leaked in validation errors'
  );
});

// Test 23: Process environment synchronization does not synthesize RENDER if omitted
runTest('Test 23 — validateEnv does not synthesize RENDER into process.env if omitted', () => {
  const originalRender = process.env.RENDER;
  delete process.env.RENDER;
  try {
    const parsed = parseEnv(validDevEnv);
    assert.strictEqual(parsed.data.RENDER, false);
    // Ensure process.env.RENDER remains undefined and is not set to 'false'
    assert.strictEqual(process.env.RENDER, undefined);
  } finally {
    if (originalRender !== undefined) {
      process.env.RENDER = originalRender;
    } else {
      delete process.env.RENDER;
    }
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
