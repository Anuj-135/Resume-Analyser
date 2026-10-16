# Phase 1, Step 1.4: Rate Limiting & AI Concurrency Guard — Planning & Architecture Specification

**Repository:** [Resume-Analyser](https://github.com/Anuj-135/Resume-Analyser)  
**Status:** Approved for Implementation  
**Date:** October 16, 2026  
**Target Milestone:** Phase 1, Step 1.4 (Rate Limiting, AI Concurrency Guard & Defensive PDF Processing)  

---

## 1. Executive Summary & Context

Following the completion of **Step 1.1** (Environment & Startup Validation Guard), **Step 1.2** (Helmet Security Headers & Centralized Error Handling), and **Step 1.3** (Zod Request Validation across all endpoints), the backend currently exhibits:
- **85 passing automated tests** across 4 suites (`test_env.js`: 23, `test_retry.js`: 7, `test_error_handling.js`: 22, `test_validation.js`: 33).
- Strict data boundary validation for request bodies, route parameters, and query parameters before reaching business logic.
- Complete isolation from external infrastructure during automated testing (mocks, stubs, and dummy credentials only).

### Step 1.4 Objectives:
1. **Authentication Rate Limiting:** Protect `POST /api/auth/login` and `POST /api/auth/register` against brute-force credential attacks and automated registration spam (10 requests per 15 minutes per client IP).
2. **AI Analysis Cost & Rate Control:** Cap `POST /api/resumes/:id/analyze` to a maximum of 5 analysis requests per authenticated user per hour.
3. **AI Analysis In-Flight Concurrency Guard:** Prevent duplicate concurrent execution of the same resume for the same user via an atomic in-memory lock (returning HTTP 409 Conflict).
4. **Defensive Cloudinary PDF Retrieval:** Enforce a strict 10-second timeout on the Cloudinary fetch (`AbortSignal.timeout(10000)`), returning HTTP 504 Gateway Timeout while redacting signed URLs and secrets.
5. **PDF Text Extraction Upper Bound:** Cap extracted resume text at 50,000 characters before calling Gemini, rejecting oversized documents with HTTP 400 Bad Request to prevent token exhaustion and document misrepresentation.
6. **Zero-Dependency Automated Tests:** Build a deterministic, isolated test suite verifying all rate-limiting, locking, and defensive processing features without connecting to MongoDB, Cloudinary, or Gemini.

---

## 2. Codebase Baseline & Confirmed Current State

### 2.1 Git Status & Tracked State
- **Active Branch:** `main` (synchronized with `origin/main`).
- **Pre-existing Tracked Modifications (10):**
  - `IMPLEMENTATION_PLAN.md`
  - `server/controllers/authController.js`
  - `server/controllers/profileController.js`
  - `server/controllers/resumeController.js`
  - `server/middleware/upload.js`
  - `server/package-lock.json`
  - `server/package.json`
  - `server/routes/authRoutes.js`
  - `server/routes/resumeRoutes.js`
  - `server/server.js`
- **Untracked Artifacts Preserved (12):**
  - `Conversion_Plan.md`, `PHASE_1_STEP_1_1_WALKTHROUGH.md`, `PHASE_1_STEP_1_2_WALKTHROUGH.md`, `PHASE_1_STEP_1_3_PLAN.md`, `artifacts/`
  - `server/config/env.js`
  - `server/middleware/errorHandler.js`
  - `server/middleware/validate.js`
  - `server/schemas/` (`authSchemas.js`, `resumeSchemas.js`)
  - `server/test_env.js`
  - `server/test_error_handling.js`
  - `server/test_validation.js`

### 2.2 Existing Protections in Active Code
- **JWT Authentication:** In `server/middleware/auth.js`, verifies HTTP-only cookie `req.cookies.token`, binding `req.userId = decoded.userId`. Mounted via `router.use(auth)` across all resume and profile routes.
- **Zod Request Validation:** In `server/middleware/validate.js`, validates `req.params.id` as a 24-character hexadecimal ObjectId before route controllers execute.
- **Tenant Isolation:** In `server/controllers/resumeController.js`, queries `Resume.findOne({ _id: id, userId: req.userId })`.
- **Magic-Byte Upload Check:** In `server/controllers/resumeController.js`, verifies leading 5 buffer bytes match `%PDF-`.
- **Transient AI Error Retries:** In `server/services/aiService.js`, retries up to 3 times on transient 429, 503, 504, and network failures with exponential backoff and jitter.

### 2.3 Confirmed Gaps Addressed in Step 1.4
- **Gap 1:** No rate limiting on `/login` or `/register` (unbounded brute-force risk).
- **Gap 2:** No rate limiting on `POST /api/resumes/:id/analyze` (unbounded Gemini API costs).
- **Gap 3:** No concurrency lock on in-flight analyses (duplicate parallel requests execute simultaneously).
- **Gap 4:** No timeout on `fetch(signedUrl)` in `pdfService.js` (worker thread can stall indefinitely if Cloudinary hangs).
- **Gap 5:** No character bound on extracted PDF text before sending to Gemini (susceptible to context overload).
- **Gap 6:** Raw fetch error in `pdfService.js` assigns `err.details = fetchErr.message`, which can leak Cloudinary signed URLs containing signatures.

---

## 3. Architecture & Design Specifications

### 3.1 Authentication Rate Limiting
- **Dependency:** `express-rate-limit` (v7.5+), peer dependency `express >= 4.11` (compatible with Express 5).
- **Policy:**
  - `POST /api/auth/login`: 10 requests per 15 minutes per client IP.
  - `POST /api/auth/register`: 10 requests per 15 minutes per client IP.
- **Limiter Topology (Separate Instances):**
  - Uses separate limiter instances (`loginLimiter` and `registerLimiter`).
  - *Trade-off Justification:* Separate limiters prevent cross-action starvation. A legitimate user who exhausts login attempts is not prevented from registering an account, and registration errors do not lock out login attempts.
- **Response Format:**
  - Status Code: HTTP 429 Too Many Requests.
  - JSON Body: `{ "message": "Too many authentication attempts. Please try again later." }`.
  - Standard Headers: `standardHeaders: 'draft-7'` (`RateLimit-Policy`, `RateLimit`), `legacyHeaders: false`, plus RFC-compliant `Retry-After: <seconds>`.

### 3.2 Reverse Proxy Configuration (`trust proxy`)
- **Render Deployment Baseline:**
  Render operates behind an edge reverse proxy that terminates TLS and forwards requests across exactly 1 proxy hop.
- **Vulnerability Analysis:**
  - `trust proxy: true` enables full IP spoofing via attacker-supplied `X-Forwarded-For` headers.
  - `trust proxy: false` causes Express to read the internal Render proxy IP, locking out all users globally after 10 requests.
- **Defensive Configuration:**
  In `server/server.js`:
  ```javascript
  if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || process.env.RENDER === true) {
    app.set('trust proxy', 1);
  }
  ```
  In local development and automated testing (`NODE_ENV === 'test'`), `trust proxy` remains `false`.
- **Render Proxy Topology Verification:**
  - When Render receives a client request with `X-Forwarded-For: 198.51.100.1`, Render appends the verified client IP: `X-Forwarded-For: 198.51.100.1, <real_client_ip>`.
  - Express configured with `trust proxy: 1` reads the 1st hop from the right (`<real_client_ip>`), rejecting the client-supplied prefix.
  - Verification in production can be validated by sending a probe to `/api/health` with a spoofed `X-Forwarded-For` header and confirming that `req.ip` reflects the actual remote address rather than the spoofed value.

### 3.3 AI Analysis Rate Limiting
- **Policy:** Maximum 5 analysis requests per authenticated user per hour (`windowMs: 60 * 60 * 1000`, `limit: 5`).
- **Limiter Key Formulation & Validation Compatibility:**
  Keyed on authenticated `req.userId` with defensive `ipKeyGenerator(req.ip)` fallback:
  ```javascript
  const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

  keyGenerator: (req) => {
    return req.userId ? req.userId.toString() : ipKeyGenerator(req.ip);
  }
  ```
  *Built-in Validation Note:* Using `ipKeyGenerator(req.ip)` satisfies `express-rate-limit` v8's built-in `keyGeneratorIpFallback` validation check directly. All built-in validations remain 100% enabled without suppressing any library checks.
- **Middleware Ordering in `server/routes/resumeRoutes.js`:**
  ```text
  1. router.use(auth)                           <-- Authenticates token; guarantees req.userId
  2. validate({ params: resumeIdParamSchema })  <-- Validates :id is 24-hex ObjectId
  3. analysisLimiter                            <-- Checks hourly quota for req.userId
  4. analyzeResume                              <-- Concurrency check, PDF fetch, AI analysis
  ```
- **Quota Accounting Policy:**
  - Unauthenticated requests receive 401 before hitting the limiter.
  - Malformed route parameters receive 400 before hitting the limiter.
  - Quota is consumed on every attempt that reaches `analysisLimiter`.
  - Downstream failures (e.g. 404 Resume Not Found, 400 Empty PDF, 502 Gemini Outage) do **NOT** refund quota (`skipFailedRequests` is omitted / false). This prevents attackers from repeatedly hammering downstream services without depleting quota.

### 3.4 AI Analysis Concurrency Guard
- **Mechanism:** In-memory `Set` of active lock keys (`activeAnalyses`) in `resumeController.js`.
- **Lock Key Structure:** `user_${req.userId}_resume_${id}` (or `${req.userId}:${id}`). Strictly collision-safe across users and resumes.
- **Atomicity:** Checking and adding to the Set is synchronous in Node's single-threaded event loop, preventing race conditions.
- **Conflict Handling:** Returns HTTP 409 Conflict immediately:
  `{ "message": "Analysis already in progress for this resume" }`
- **Guaranteed Release in `finally`:**
  Enclosed in a `try ... finally` block wrapping the entire execution of `analyzeResume`:
  ```javascript
  try {
    // 1. Resume lookup & public_id verification
    // 2. PDF download & text extraction
    // 3. Gemini AI analysis
    // 4. Persistence to MongoDB
    // 5. Response 200 JSON
  } finally {
    activeAnalyses.delete(lockKey);
  }
  ```
  Guarantees lock deletion on success, client validation errors, download timeouts, AI errors, and unexpected exceptions. Subsequent requests for the same resume proceed normally.

### 3.5 Defensive PDF Processing & Secret Redaction
- **Cloudinary Download Timeout:**
  In `server/services/pdfService.js`:
  ```javascript
  const response = await fetch(signedUrl, {
    signal: AbortSignal.timeout(10000),
  });
  ```
  - Catches `TimeoutError` / `AbortError` and throws `DOWNLOAD_TIMEOUT`.
  - Mapped in `resumeController.js` to HTTP 504 Gateway Timeout:
    `{ "message": "Timed out retrieving resume from storage" }`
- **Secret Redaction:**
  In `pdfService.js`, removes `err.details = fetchErr.message` to prevent leaking signed URLs containing Cloudinary API signatures.
- **Extracted Text Bound (50,000 Characters):**
  - PDF parser (`pdf-parse` v2.4.5) parses the in-memory buffer.
  - Enforces:
    ```javascript
    const MAX_EXTRACTED_CHARACTERS = 50000;
    if (cleanedText.length > MAX_EXTRACTED_CHARACTERS) {
      const err = new Error('Resume text exceeds maximum allowed length');
      err.code = 'TEXT_TOO_LONG';
      throw err;
    }
    ```
  - Mapped in `resumeController.js` to HTTP 400 Bad Request:
    `{ "message": "Resume text exceeds maximum allowed length of 50,000 characters" }`
  - Rejection is chosen over silent truncation because truncation would mutilate resumes and mislead Gemini into flagging missing sections.

---

## 4. Implementation Sequence

### Phase 1: Dependency Addition & Rate Limiter Module *(Current Execution Target)*
1. Add `"express-rate-limit": "^7.5.0"` to `server/package.json` dependencies and install.
2. Create `server/middleware/rateLimiter.js` with:
   - `createRateLimiter` factory.
   - `loginLimiter` (10 / 15m per IP).
   - `registerLimiter` (10 / 15m per IP).
   - `analysisLimiter` (5 / 1h per user, with IP fallback and `skipFailedRequests: true`).
3. Update `server/server.js` with conditional `trust proxy: 1`.

### Phase 2: Route & Controller Integration
1. Mount `registerLimiter` and `loginLimiter` in `server/routes/authRoutes.js`.
2. Mount `analysisLimiter` in `server/routes/resumeRoutes.js`.
3. Implement `activeAnalyses` Set concurrency guard with `try ... finally` release in `server/controllers/resumeController.js`.

### Phase 3: Defensive PDF Fetch & Text Bound Enforcement
1. Add `AbortSignal.timeout(10000)` and `DOWNLOAD_TIMEOUT` error handling to `server/services/pdfService.js`.
2. Redact signed URLs and credentials from error details in `pdfService.js`.
3. Enforce 50,000-character ceiling (`TEXT_TOO_LONG`) in `pdfService.js`.
4. Map `DOWNLOAD_TIMEOUT` to HTTP 504 and `TEXT_TOO_LONG` to HTTP 400 in `server/controllers/resumeController.js`.

### Phase 4: Automated Testing & Verification
1. Create `server/test_rate_limit.js` with 24 isolated tests.
2. Add `"test:ratelimit"` to `server/package.json` and update `"test"` script.
3. Verify that all 109 automated tests pass with zero external dependencies.

---

## 5. Acceptance Criteria

- [ ] `POST /api/auth/login` returns HTTP 429 when client IP exceeds 10 requests per 15 minutes.
- [ ] `POST /api/auth/register` returns HTTP 429 when client IP exceeds 10 requests per 15 minutes.
- [ ] Auth 429 responses return standard `RateLimit` / `Retry-After` headers and `{ "message": "Too many authentication attempts. Please try again later." }`.
- [ ] Exhausting login quota does not exhaust registration quota for the same client IP.
- [ ] `trust proxy: 1` is applied only in production or when running on Render.
- [ ] `POST /api/resumes/:id/analyze` returns HTTP 429 when authenticated user exceeds 5 requests per hour.
- [ ] Different authenticated users have independent analysis quotas even when sharing an IP address.
- [ ] Unauthenticated requests receive HTTP 401 before consuming any analysis quota.
- [ ] Malformed `:id` route parameters receive HTTP 400 before consuming any analysis quota.
- [ ] Simultaneous duplicate requests for the same user and resume return HTTP 409 `{ "message": "Analysis already in progress for this resume" }`.
- [ ] Concurrent requests for different resumes or different users do not collide.
- [ ] The concurrency lock is released in a `finally` block across all success, error, timeout, and exception paths.
- [ ] A completed analysis allows subsequent re-analysis of the same resume.
- [ ] Cloudinary PDF fetch times out after 10 seconds via `AbortSignal.timeout(10000)` and returns HTTP 504 without leaking signed URLs.
- [ ] Extracted resume text exceeding 50,000 characters is rejected with HTTP 400 Bad Request before calling Gemini.
- [ ] All 85 existing automated tests continue to pass without regressions (109 passing tests total).
- [ ] All automated tests run with zero external network or database dependencies.
