# Phase 1, Step 1.1: Environment and Startup Validation — Walkthrough

**Repository:** [https://github.com/Anuj-135/Resume-Analyser](https://github.com/Anuj-135/Resume-Analyser)  
**Date:** October 14, 2026  
**Status:** Completed — Step 1.1 & Step 1.1.1 (Production Environment Guard)  

---

## 1. Overview & Objectives

In accordance with the approved Phase 1 plan and Step 1.1.1 specifications, centralized, fail-fast environment variable validation at backend startup using Zod enforces:
- When running on Render (`RENDER=true`), `NODE_ENV` must be explicitly set to `production`. Any missing, empty, `'development'`, or `'test'` value immediately aborts startup with a sanitized error.
- When running in a normal local environment (omitted `RENDER`), omitted or empty `NODE_ENV` cleanly defaults to `'development'`.
- Required secrets are validated for presence and format before the application connects to databases or accepts HTTP requests.
- In production, weak JWT secrets (< 32 characters), missing Gemini API keys, or placeholder Cloudinary credentials cause an immediate, sanitized startup abort.
- In development, legitimate developer workflows are preserved (placeholder Cloudinary credentials and default local origins are accepted without error).
- Secret values are never printed in logs, exceptions, or validation output.

---

## 2. Files Added or Modified

| File Path | Type | Description |
|---|---|---|
| `server/config/env.js` | Added | Centralized Zod validation module exporting `envSchema`, `cleanEnvObject`, `parseEnv`, `validateEnv`, and `formatValidationErrors`. Includes Step 1.1.1 Render production guard. |
| `server/server.js` | Modified | Imported and invoked `validateEnv()` immediately after `require('dotenv').config()`, ensuring fail-fast startup behavior before server or database initialization. |
| `server/package.json` | Modified | Added `"zod": "^4.6.7"` dependency and configured test scripts: `"test"`, `"test:env"`, `"test:retry"`. |
| `server/package-lock.json` | Modified | Updated lockfile for `zod`. |
| `server/test_env.js` | Added | Focused automated test suite verifying 23 environment validation scenarios (including 9 Step 1.1.1 guard & secret safety tests). |

---

## 3. Environment Variables Validated

| Variable Name | Type / Format | Status in Development / Test | Status in Production | Default Value | Validation Rule |
|---|---|---|---|---|---|
| `NODE_ENV` | Enum (`'development'`, `'production'`, `'test'`) | Optional | Required | `'development'` | Must be one of: `"development"`, `"production"`, `"test"`. |
| `PORT` | Integer (`1`–`65535`) | Optional | Optional | `5000` | Coerced from string to integer; must be between 1 and 65535. |
| `MONGODB_URI` | String | **Required** | **Required** | None | Must be non-empty and start with `mongodb://` or `mongodb+srv://`. |
| `CLIENT_URL` | URL String | Optional | **Required** | `http://localhost:3000` | Must be a valid URL string (e.g. `http://localhost:3000` or `https://...`). |
| `JWT_SECRET` | String | **Required** (min 8 chars) | **Required** (min 32 chars) | None | In production, must be at least 32 characters long. Value is never logged. |
| `JWT_EXPIRES_IN` | String | Optional | Optional | `'7d'` | Non-empty string specifying token validity duration. |
| `GEMINI_API_KEY` | String | Optional (if AI uncalled) | **Required** | None | Non-empty API key required in production. |
| `GEMINI_MODEL` | String | Optional | Optional | `'gemini-3.8-flash'` | Model identifier used for AI prompt generation. |
| `CLOUDINARY_CLOUD_NAME` | String | Optional (`'placeholder'` allowed) | **Required** (non-placeholder) | None | In production, cannot be empty or `"placeholder"`. |
| `CLOUDINARY_API_KEY` | String | Optional (`'placeholder'` allowed) | **Required** (non-placeholder) | None | In production, cannot be empty or `"placeholder"`. |
| `CLOUDINARY_API_SECRET` | String | Optional (`'placeholder'` allowed) | **Required** (non-placeholder) | None | In production, cannot be empty or `"placeholder"`. |

---

## 4. Application Startup Integration

Validation is hooked into the entrypoint (`server/server.js`) at line 6:
```javascript
const path = require('path');
require('dotenv').config();
const { validateEnv } = require('./config/env');

// Validate environment variables immediately at startup before service initialization
validateEnv();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
```

### Startup Behavior:
1. **On Valid Configuration:**
   - Populates validated defaults back into `process.env` (e.g., `process.env.NODE_ENV = 'development'`, `process.env.PORT = '5000'`, `process.env.GEMINI_MODEL = 'gemini-3.8-flash'`).
   - Execution proceeds normally to `connectDB()` and `app.listen()`.
2. **On Invalid Configuration:**
   - Prints a formatted, non-sensitive error banner to `console.error`:
     ```text
     ====================================================
     ❌ SERVER CONFIGURATION ERROR: Invalid Environment
     ====================================================
     The following environment variables failed validation:

       • [JWT_SECRET]: JWT_SECRET must be at least 32 characters long in production (current length: 16)
       • [CLOUDINARY_CLOUD_NAME]: CLOUDINARY_CLOUD_NAME is required and cannot be empty or "placeholder" in production
     ====================================================
     ```
   - Immediately terminates the process via `process.exit(1)`. No unhandled promise rejections or partial boots occur.

---

## 5. Automated Tests & Actual Results

### Command Executed:
`npm --prefix server test` (Runs `node test_env.js && node test_retry.js`)

### Output Summary:
```text
====================================================
Step 1.1: Environment & Startup Validation Tests
====================================================

[PASS] Test 1 — Valid development configuration is accepted with defaults
[PASS] Test 2 — Valid production configuration is accepted
[PASS] Test 3 — Missing MONGODB_URI is rejected with clear error
[PASS] Test 4 — Missing JWT_SECRET is rejected with clear error
[PASS] Test 5 — Weak production JWT secret (< 32 chars) is rejected
[PASS] Test 6 — Reasonable development JWT secret (>= 8 chars) is accepted in dev
[PASS] Test 7 — Invalid NODE_ENV values are rejected
[PASS] Test 8 — Non-MongoDB URI protocol is rejected
[PASS] Test 9 — Invalid CLIENT_URL format is rejected
[PASS] Test 10 — Invalid PORT (out of range or non-number) is rejected
[PASS] Test 11 — Production rejects missing Gemini key and placeholder Cloudinary credentials
[PASS] Test 12 — Development accepts placeholder Cloudinary credentials
[PASS] Test 13 — Whitespace and empty strings are cleanly assigned defaults
[PASS] Test 14 — validateEnv() throws structured error when exitOnError is false
[PASS] Test 15 — Local environment with omitted NODE_ENV defaults to "development"
[PASS] Test 16 — Local environment with empty NODE_ENV string defaults to "development"
[PASS] Test 17 — Render environment with omitted or empty NODE_ENV fails validation
[PASS] Test 18 — Render environment with NODE_ENV=development fails validation
[PASS] Test 19 — Render environment with NODE_ENV=test fails validation
[PASS] Test 20 — Render environment with explicit NODE_ENV=production passes guard and prod checks
[PASS] Test 21 — Existing valid local development and test configurations pass
[PASS] Test 22 — Dummy GEMINI_API_KEY and CLOUDINARY_API_SECRET values are not reflected in validation errors
[PASS] Test 23 — validateEnv does not synthesize RENDER into process.env if omitted

====================================================
Results: 23 passed, 0 failed
====================================================

====================================================
Section 7: Gemini AI Transient Error Retry Tests
====================================================

[PASS] Test 1 — Immediate success on first attempt
[PASS] Test 2 — Transient failure (503 UNAVAILABLE) then success on retry
[PASS] Test 3 — Multiple transient failures (503 then 429) then success on attempt 3
[PASS] Test 4 — Retry exhaustion after 3 failed attempts (503 UNAVAILABLE)
[PASS] Test 5 — Permanent error (403 PERMISSION_DENIED) fails immediately without retry
[PASS] Test 6 — Output structure and schema validation preserved after retry
[PASS] Test 7 (Bonus) — Transient network error (fetch failed) retries and succeeds

====================================================
Results: 7 passed, 0 failed
====================================================
```
**Total: 30 passed, 0 failed (100% success rate).**

---

## 6. Assumptions, Limitations & Non-Disclosure Verification

- **Non-Disclosure of Secrets:** Verified programmatically in Test 5 and Test 14 that secret values are never included in error strings, formatted issues, or logs.
- **Local Development Preservation:** Verified in Test 1, Test 6, Test 12, and against the active `server/.env` file that local development continues to work without disruption.
- **Zero Frontend or Database Impact:** No client-side files, database schemas, or database records were modified.

---

## 7. Recommended Production Deployment Settings (Render / Vercel)

These are recommendations for production configuration on the hosting platforms; no live deployment changes were made:

1. **Render (Backend Environment):**
   - Ensure `NODE_ENV=production` is explicitly set in Render service settings.
   - Ensure `JWT_SECRET` is set to a cryptographically secure random string with length >= 32 characters (e.g. generated via `openssl rand -hex 32`).
   - Ensure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are populated with live credentials instead of `'placeholder'`.
   - Ensure `CLIENT_URL` matches `https://resume-analyser-sooty-delta.vercel.app` (without trailing slash).
2. **Vercel (Frontend Environment):**
   - Ensure `NEXT_PUBLIC_API_URL` points to the Render production URL (e.g. `https://<render-service-name>.onrender.com/api`).
