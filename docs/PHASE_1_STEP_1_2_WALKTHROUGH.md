# Phase 1, Step 1.2: Security Headers & Centralized Error Handling — Walkthrough

**Repository:** [https://github.com/Anuj-135/Resume-Analyser](https://github.com/Anuj-135/Resume-Analyser)  
**Date:** October 14, 2026  
**Status:** Completed — Step 1.2 & Step 1.2.1 (Targeted Error-Handling Security Fixes)  

---

## 1. Overview & Objectives

In accordance with Phase 1, Step 1.2 and Step 1.2.1, this implementation secures the Express API backend with:
1. **Helmet Security Headers:** Applied as the very first middleware to inject defensive HTTP headers without interfering with the decoupled cross-origin frontend on Vercel. Both 200 OK and 404 error responses carry defensive headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Cross-Origin-Resource-Policy: cross-origin`).
2. **Centralized Error Handling:** Consistent, sanitized JSON responses for all error conditions (malformed JSON, Mongoose cast/validation errors, MongoDB duplicate keys, Multer upload errors, JWT failures, and unexpected 500 errors).
3. **Headers-Sent Delegation (Fix 1):** `errorHandler` immediately checks `if (res.headersSent) { return next(err); }`, delegating safely to the default Express handler if response streaming has started.
4. **Consistent JSON 404 Handler:** Catches unmatched routes and returns `{ "message": "Route not found" }` without reflecting arbitrary client input or parameters.
5. **Log Query String Stripping (Fix 2):** Request paths in server error logs strip query parameters (`req.path`), preventing sensitive tokens or API keys passed in query strings from being logged.
6. **Mongoose Validation Value Sanitization (Fix 4):** Ensures user-supplied values are scrubbed and replaced with clean field-level messages (`${field} does not meet the minimum length requirement`), preventing sensitive input reflection.
7. **Secret Non-Disclosure:** Ensures stack traces, internal paths, database URIs, API keys, and tokens are never returned to the client, while keeping structured diagnostic logs on the server console.

---

## 2. Files Added or Modified

| File Path | Type | Description |
|---|---|---|
| `server/middleware/errorHandler.js` | Added | Centralized error handler and 404 handler. Implements conservative error mapping, `res.headersSent` delegation, query-string stripped log context, Mongoose value sanitization, and uniform JSON response contracts. |
| `server/server.js` | Modified | Mounted `helmet` at the top of the middleware stack; mounted `notFoundHandler` and `errorHandler` after all routes. |
| `server/package.json` | Modified | Added `"helmet": "^8.3.0"` dependency and configured `"test:error"` and updated `"test"` scripts. |
| `server/package-lock.json` | Modified | Updated lockfile for `helmet`. |
| `server/test_error_handling.js` | Added | Automated test suite verifying 16 scenarios for Helmet headers (including on 404s), health check, 404 JSON, known error mappings, `headersSent` delegation, log query stripping, Mongoose value non-disclosure, 500 generic handling, and secret non-disclosure. |

---

## 3. Middleware Order in `server/server.js`

```text
1. validateEnv()                       <-- Step 1.1 / 1.1.1 Environment & Startup Guard
2. app.use(helmet({ ... }))            <-- Step 1.2: Defensive Security Headers (applied to all responses)
3. app.use(cors({ ... }))              <-- Cross-Origin Resource Sharing (allowlist & credentials preserved)
4. app.use(cookieParser())             <-- Cookie parsing
5. app.use(express.json())             <-- JSON body parsing
6. Application Routes:
   - app.get('/api/health', ...)
   - app.use('/api/auth', authRoutes)
   - app.use('/api/resumes', resumeRoutes)
   - app.use('/api/profile', profileRoutes)
7. app.use(notFoundHandler)            <-- Step 1.2: Unmatched Route JSON 404 Fallback
8. app.use(errorHandler)               <-- Step 1.2: 4-argument Centralized JSON Error Handler
```

---

## 4. Security Header Configuration Details

The backend API runs on Render, while the frontend runs on Vercel (`https://resume-analyser-sooty-delta.vercel.app`). The Helmet baseline is configured specifically for this decoupled architecture:

```javascript
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: {
      maxAge: 15552000,
      includeSubDomains: false,
    },
  })
);
```

| Header | Setting / Value | Rationale |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevents browsers from MIME-sniffing away from `application/json`. Confirmed on both 200 and 404. |
| `X-Frame-Options` | `SAMEORIGIN` | Mitigates clickjacking attacks. Confirmed on both 200 and 404. |
| `Cross-Origin-Resource-Policy` | `cross-origin` | Permits cross-origin API consumption by the Vercel frontend without CORP blocking. |
| `Strict-Transport-Security` | `max-age=15552000` | Enforces HTTPS with conservative scope (subdomains not expanded). |
| `Content-Security-Policy` | Disabled (`false`) | Backend is purely a JSON API. Next.js handles HTML document CSP on Vercel. |
| `X-Download-Options` | `noopen` | Prevents internet zone file execution in legacy browsers. |
| `X-Permitted-Cross-Domain-Policies` | `none` | Blocks cross-domain Flash/PDF policy access. |
| `Referrer-Policy` | `no-referrer` | Eliminates referrer leakage. |
| `X-Powered-By` | Removed | Eliminates Express technology fingerprinting. |

---

## 5. Error Mapping Matrix

All client responses adhere strictly to the contract expected by [client/lib/store.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/client/lib/store.js) (`{ message: string }`).

| Trigger Condition | HTTP Status | Response Payload | Server Diagnostic |
|---|---|---|---|
| **Headers Already Sent** (`res.headersSent`) | Delegated | Delegates to `next(err)` | Prevents `ERR_HTTP_HEADERS_SENT` crash |
| **Unmatched Route** | `404 Not Found` | `{"message": "Route not found"}` | None (normal fallback) |
| **Malformed JSON Body** (`SyntaxError` with body) | `400 Bad Request` | `{"message": "Invalid JSON payload"}` | Logged with method & clean path |
| **Mongoose `CastError`** (invalid ObjectId) | `400 Bad Request` | `{"message": "Invalid resource ID format"}` | Logged with path & type |
| **Mongoose `ValidationError`** (values scrubbed) | `400 Bad Request` | `{"message": "<Safe field-level requirement>"}` | Logged field names without values |
| **MongoDB Duplicate Key (`11000`)** on email | `409 Conflict` | `{"message": "Email is already registered"}` | Logged duplicate field |
| **MongoDB Duplicate Key (`11000`)** on other field | `409 Conflict` | `{"message": "Duplicate value for field: <field>"}` | Logged duplicate field |
| **Multer File Size (`LIMIT_FILE_SIZE`)** | `400 Bad Request` | `{"message": "File size exceeds limit of 10MB"}` | Logged upload error |
| **Multer File Type (`INVALID_FILE_TYPE`)** | `400 Bad Request` | `{"message": "Only PDF files are allowed"}` | Logged upload error |
| **Multer Unexpected Field (`LIMIT_UNEXPECTED_FILE`)** | `400 Bad Request` | `{"message": "Unexpected field in form upload"}` | Logged upload error |
| **JWT Invalid (`JsonWebTokenError`)** | `401 Unauthorized` | `{"message": "Unauthorized: Invalid token"}` | Logged auth error |
| **JWT Expired (`TokenExpiredError`)** | `401 Unauthorized` | `{"message": "Unauthorized: Token has expired"}` | Logged auth error |
| **Operational `AppError(msg, status)`** | `status` (4xx) | `{"message": "<msg>"}` | Logged client error |
| **Unexpected Server Error** (500) | `500 Internal Server Error` | `{"message": "Internal server error"}` | Sanitized diagnostic logged; **never sent to client** |

---

## 6. Automated Test Results

### Command
```bash
npm --prefix server test
```

### Output Summary
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

Results: 23 passed, 0 failed

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

Results: 7 passed, 0 failed

====================================================
Step 1.2: Security Headers & Error Handling Tests
====================================================
[PASS] Test 1 — Helmet applies secure baseline headers to responses
[PASS] Test 2 — Health check route /api/health responds with status 200 and expected payload
[PASS] Test 3 — Unmatched route returns 404 JSON with generic message without reflecting input
[PASS] Test 4 — Unmatched POST route returns consistent 404 JSON with Helmet headers
[PASS] Test 5 — Malformed JSON payload is caught and mapped to 400 Bad Request
[PASS] Test 6 — Mongoose CastError is safely mapped to 400 Bad Request
[PASS] Test 7 — Mongoose ValidationError is safely mapped to 400 with clean field messages
[PASS] Test 8 — MongoDB duplicate key error is mapped to 409 Conflict with safe message
[PASS] Test 9 — Multer upload errors are safely mapped to 400 Bad Request
[PASS] Test 10 — JWT errors are mapped to 401 Unauthorized
[PASS] Test 11 — Unexpected 500 error returns generic message without leaking secrets or stack trace
[PASS] Test 12 — Unexpected 500 error in development still returns sanitized JSON without secret leakage
[PASS] Test 13 — Operational AppError returns defined status code and message
[PASS] Test 14 — errorHandler delegates using next(err) when headers have already been sent
[PASS] Test 15 — Server log context strips query strings and does not leak sensitive query parameters
[PASS] Test 16 — Mongoose validation error does not reflect user-supplied sensitive values in client response

Results: 16 passed, 0 failed
```
**Total Backend Tests: 46 passed, 0 failed (100% pass rate).**

### Client Lint
```bash
npm --prefix client run lint
```
**Result:** Exit code `0` (0 errors, 15 pre-existing `@next/next/no-img-element` warnings; zero regressions).

---

## 7. Manual Verification Instructions

1. **Verify Health Check & Security Headers:**
   ```bash
   curl -i http://localhost:5000/api/health
   ```
   - Expect HTTP 200.
   - Expect headers:
     - `x-content-type-options: nosniff`
     - `x-frame-options: SAMEORIGIN`
     - `cross-origin-resource-policy: cross-origin`
     - `strict-transport-security: max-age=15552000`
     - Absence of `x-powered-by`

2. **Verify JSON 404 Unmatched Route:**
   ```bash
   curl -i http://localhost:5000/api/nonexistent-route
   ```
   - Expect HTTP 404.
   - Expect body: `{"message":"Route not found"}`.

3. **Verify Malformed JSON Body Protection:**
   ```bash
   curl -i -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d "invalid-json{"
   ```
   - Expect HTTP 400.
   - Expect body: `{"message":"Invalid JSON payload"}`.
