# Phase 1, Step 1.3: Zod Request Validation — Planning & Architecture Specification

**Repository:** [Resume-Analyser](https://github.com/Anuj-135/Resume-Analyser)  
**Status:** Investigation & Planning Only — Read-Only Review (No application code changed)  
**Date:** October 15, 2026  
**Target Milestone:** Phase 1, Step 1.3 (Zod Schema Validation Middleware)  

---

## 1. Executive Summary & Context

Following the completion of **Step 1.1** (Environment & Startup Guard), **Step 1.2** (Helmet Security Headers & Centralized Error Handling), and **Step 1.2.2** (Targeted Error-Logging & Credential Redaction), the backend currently features:
- 52 passing automated tests across 3 suites (`test_env.js`: 23, `test_retry.js`: 7, `test_error_handling.js`: 22).
- Zero client ESLint errors (15 pre-existing `@next/next/no-img-element` warnings preserved).
- Complete isolation from external infrastructure during automated testing (mocks and dummy credentials only).

**Step 1.3 Objective:** Implement declarative, schema-based request validation using the installed [Zod v4.6.7](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/package.json#L30) across all incoming HTTP requests (bodies, route parameters, and query parameters) before business logic executes. This eliminates ad-hoc controller assertions, protects MongoDB from oversized or malformed payloads, guards against mass-assignment, and ensures standard, safe client responses for invalid inputs.

---

## 2. Codebase Inspection & Current Architecture

### 2.1 Route Registration & Middleware Stack Order
In [server/server.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/server.js#L18-L62):
```text
1. validateEnv()                              <-- Step 1.1: Startup validation
2. app.use(helmet({ ... }))                   <-- Step 1.2: Defensive security headers
3. app.use(cors({ ... }))                     <-- Cross-Origin Resource Sharing
4. app.use(cookieParser())                    <-- Cookie parsing
5. app.use(express.json())                    <-- JSON body parsing (100kb default limit)
6. Routes:
   - app.get('/api/health', ...)
   - app.use('/api/auth', authRoutes)
   - app.use('/api/resumes', resumeRoutes)
   - app.use('/api/profile', profileRoutes)
7. app.use(notFoundHandler)                   <-- Step 1.2: 404 JSON fallback
8. app.use(errorHandler)                      <-- Step 1.2 / 1.2.2: Centralized error handler
```

### 2.2 Endpoint Definitions & Current Validation Practices

| Endpoint | Route File | Controller / Middleware | Current Input Validation in Active Code | Validation Gaps |
|---|---|---|---|---|
| `POST /api/auth/register` | [authRoutes.js:L6](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js#L6) | [authController.js:L22-L61](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L22-L61) | Checks `!name \|\| !email \|\| !password`. Trims email/name. Mongoose checks unique email. | No email format check; no length bounds on name; no password byte-length check; accepts arbitrary extra body properties. |
| `POST /api/auth/login` | [authRoutes.js:L7](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js#L7) | [authController.js:L65-L102](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L65-L102) | Checks `!email \|\| !password`. Trims email. | No email format check; no upper safety bound on payload; accepts arbitrary extra body properties. |
| `POST /api/auth/logout` | [authRoutes.js:L8](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js#L8) | [authController.js:L106-L122](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L106-L122) | None (clears cookie). | None needed; body/query should be ignored. |
| `GET /api/auth/me` | [authRoutes.js:L9](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js#L9) | [auth.js:L3-L17](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/middleware/auth.js#L3-L17), [authController.js:L126-L149](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L126-L149) | Verifies JWT cookie via `auth` middleware. | None needed; body/query ignored. |
| `POST /api/resumes` | [resumeRoutes.js:L17](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L17) | [upload.js:L31-L47](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/middleware/upload.js#L31-L47), [resumeController.js:L8-L68](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L8-L68) | Multer checks single file, 10MB limit, `.pdf` extension/mimetype. Controller checks `%PDF-` magic bytes, `!companyName \|\| !jobTitle`. | `companyName` and `jobTitle` lack upper length limits; `jobDescription` is completely unbounded (risk of multi-MB strings forwarded to Gemini AI). |
| `GET /api/resumes` | [resumeRoutes.js:L19](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L19) | [resumeController.js:L71-L84](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L71-L84) | Scopes by `req.userId`. | No query parameters currently supported. |
| `GET /api/resumes/:id` | [resumeRoutes.js:L20](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L20) | [resumeController.js:L87-L117](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L87-L117) | Inline check: `if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400)`. | Validated manually in controller rather than at route boundary. |
| `DELETE /api/resumes/:id` | [resumeRoutes.js:L21](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L21) | [resumeController.js:L120-L151](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L120-L151) | Inline check: `if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400)`. | Validated manually in controller rather than at route boundary. |
| `DELETE /api/resumes` | [resumeRoutes.js:L22](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L22) | [resumeController.js:L154-L182](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L154-L182) | Scopes by `req.userId`. | None needed; destructive wipe scoped strictly to session owner. |
| `POST /api/resumes/:id/analyze` | [resumeRoutes.js:L18](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js#L18) | [resumeController.js:L185-L260](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/resumeController.js#L185-L260) | Inline check: `if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400)`. | Validated manually in controller rather than at route boundary. |
| `GET /api/profile/analytics` | [profileRoutes.js:L10](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/profileRoutes.js#L10) | [profileController.js:L9-L33](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/profileController.js#L9-L33) | Scopes by `req.userId`. | No query parameters currently supported. |
| `GET /api/health` | [server.js:L44](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/server.js#L44) | Inline handler | None. | Public health probe; no input expected. |

---

## 3. Explicit Design Resolutions

### 3.1 Design Question 1 — Password Compatibility & Bcrypt Truncation Limits
- **Codebase & Runtime Inspection:**
  - In [authController.js:38](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L38), `bcrypt.hash(password, 10)` hashes passwords at registration.
  - In [authController.js:83](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L83), `bcrypt.compare(password, user.passwordHash)` compares passwords at login.
  - The installed `bcrypt` module natively operates with a hard algorithmic ceiling of **72 UTF-8 bytes**. Verification on the installed runtime confirms:
    `bcrypt.compareSync(pass72 + 'extra', hash72)` evaluates to `true`. Bcrypt silently truncates inputs beyond 72 bytes.
  - JavaScript's native string `.length` counts UTF-16 code units, not UTF-8 bytes. For example, 19 four-byte emojis (such as 🔒) produce `.length === 38` (surrogate pairs), but occupy `76 bytes` in UTF-8. A standard `.max(72)` rule would erroneously accept 76-byte strings that bcrypt silently truncates.
  - The frontend registration client ([RegisterPage:L41](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/client/app/auth/register/page.jsx#L41)) validates:
    ```javascript
    if (password.length < 6) {
      setLocalError("Password must be at least 6 characters long.");
      return;
    }
    ```
- **Policy Decisions:**
  - **For Registration (`registerBodySchema`):**
    - Enforce the 6-character minimum: `.min(6, 'Password must be at least 6 characters long')` to match frontend validation.
    - Enforce the 72-byte ceiling via a UTF-8 byte-length check:
      ```javascript
      .refine((val) => Buffer.byteLength(val, 'utf8') <= 72, {
        message: 'Password cannot exceed 72 bytes',
      })
      ```
  - **For Login (`loginBodySchema`):**
    - Enforce a non-empty string: `z.string({ message: 'Password is required' }).min(1, 'Password is required')`.
    - Apply an upper safety guard of 1000 characters (`.max(1000, 'Password cannot exceed 1000 characters')`) against denial-of-service payload abuse.
    - **DO NOT** enforce the 6-character minimum or the 72-byte restriction on login.
- **Compatibility Limitation & Reality:**
  - Keeping login validation permissive avoids introducing *new* rejection barriers at the API validation layer for historical accounts.
  - **Limitation Note:** We do not promise that every historical password is guaranteed to authenticate. Accounts created prior to validation, accounts registered with passwords exceeding 72 bytes (which bcrypt truncated to 72 bytes at hash time), or any anomalous historical entries remain subject to bcrypt's inherent 72-byte comparison truncation and the stored hash value in MongoDB. No changes are made to existing password hashing or comparison logic.

---

### 3.2 Design Question 2 — Email Compatibility & Login Behavior Change
- **Existing Implementation & Repository Evidence:**
  - In [authController.js:30, 76](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/controllers/authController.js#L30), the controller only checks `if (!email)` and executes `email.toLowerCase().trim()`.
  - In [User.js:9-15](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/models/User.js#L9-L15), the Mongoose schema specifies `required: true, unique: true, lowercase: true, trim: true`, but has no regex or email format validator.
  - In [RegisterPage:L94](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/client/app/auth/register/page.jsx#L94) and [LoginPage](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/client/app/auth/login/page.jsx), both forms use `<input type="email" required />`, which enforces basic HTML5 email format client-side in standard browser interactions.
- **Documented Behavior Change on Login:**
  - Previously, sending a malformed email (e.g. `not-an-email`) to `POST /api/auth/login` resulted in `User.findOne({ email: 'not-an-email' })` returning `null`, causing the controller to respond:
    `HTTP 401: { "message": "Invalid email or password" }`.
  - With Zod validation on `loginBodySchema`, sending a malformed email is intercepted at the route boundary before controller execution or database access, responding:
    `HTTP 400: { "message": "Invalid email address" }`.
- **Database Status Note:**
  - Live production user records have **not** been inspected (as this development and test environment operates in strict network isolation from live databases). While repository evidence indicates standard frontend users register with valid email formats, if any historical record was manually created with an invalid email, validating email format on login will reject authentication attempts with 400. Documenting this behavior change ensures full transparency.

---

### 3.3 Design Question 3 — Express 5.2.1 Request Properties & Mutation Strategy
- **Inspection of Express 5.2.1:**
  - `req.body`: Created as an own property by `express.json()` and Multer. Reassigning `req.body = result.data` is fully supported, safe, and reliably consumed by controllers reading `const { companyName, jobTitle } = req.body`.
  - `req.params`: Created as an own object by Express route matching. When middleware and controllers are declared in the same route handler chain (`router.get('/:id', validate({ params }), controller)`), they share the same `req.params` instance. Updating property values in place via `Object.assign(req.params, result.data)` ensures `const { id } = req.params` in `resumeController.js` reliably reads the validated and trimmed ID without requiring controller modifications.
  - `req.query`: In Express 5.2.1, `express.request.prototype.query` has a getter with **no setter** (`set: undefined`). In strict mode (`'use strict'`), direct assignment `req.query = result.data` throws:
    `TypeError: Cannot set property query of #<IncomingMessage> which has only a getter`.
- **Explicit Handling of Missing / Falsy Input (No Silent Masking):**
  - Previously, draft code passed `target.schema.safeParse(target.data || {})`.
  - Silently replacing falsy or missing input with `{}` masks missing bodies, `null` payloads, or invalid non-object types (e.g. primitive strings or numbers).
  - **Refined Strategy:** In `validate.js`, explicitly check:
    ```javascript
    if (target.data === undefined || target.data === null || typeof target.data !== 'object') {
      return next(new AppError(`${target.requiredLabel} must be a valid object`, 400));
    }
    ```
    This guarantees that missing or non-object inputs are rejected explicitly with a clean 400 error rather than masked with an artificial empty object.
- **Controller Interface Preservation:**
  - Existing controllers continue reading `req.body` and `req.params`. No controller refactoring is performed.
  - In addition, the middleware sets `req.validated = { body, params, query }` for forward-compatible, clean access.
  - If `req.query` is validated, `Object.defineProperty(req, 'query', { value: result.data, writable: true, enumerable: true, configurable: true })` defines an own property on `req`, safely bypassing the prototype getter limitation.

---

### 3.4 Design Question 4 — ObjectId Validation & Response Parity
- **Inspection:**
  - Existing controllers (`resumeController.js:89, 122, 187`) manually check:
    ```javascript
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid resume ID format' });
    }
    ```
  - `mongoose.Types.ObjectId.isValid` accepts 24-character hexadecimal strings, but can also accept 12-byte raw buffers or non-standard byte sequences.
- **Decision & Parity:**
  - Validate `id` with the 24-character hexadecimal regex:
    ```javascript
    const resumeIdParamSchema = z.object({
      id: z
        .string({ message: 'Resume ID is required' })
        .trim()
        .regex(/^[0-9a-fA-F]{24}$/, 'Invalid resume ID format'),
    });
    ```
  - **Avoid Unnecessary `.strict()` on Route Parameters:** Do **not** call `.strict()` on `resumeIdParamSchema` or `objectIdParamSchema`. Route parameters are defined strictly by the route pattern (e.g. `/:id`). Rejecting unknown route parameters via `.strict()` would cause unexpected failures if parent routers use `mergeParams: true` or middleware attaches routing metadata. The schema validates the `id` parameter strictly without interfering with unrelated route properties.
  - **Response Message Parity:** Preserves the exact message `'Invalid resume ID format'` and HTTP 400 status, maintaining 100% compliance with existing controllers, frontend expectations, and `test_error_handling.js`.

---

### 3.5 Design Question 5 — Error Handling & Centralized Integration
- **Inspection of `errorHandler.js`:**
  - Lines 158-168: Branch 7 catches `err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500`.
  - Sets `statusCode = err.statusCode` (400).
  - Sets `clientMessage = err.message.trim()`.
  - Lines 190-192 log: `[Client Error] METHOD PATH -> 400: clientMessage`.
  - Line 195 responds: `res.status(statusCode).json({ message: clientMessage })`.
- **Contract & Security Guarantees:**
  - When `validate` catches a schema failure, it instantiates `new AppError(formattedMessage, 400)` and forwards it via `next(err)`.
  - Client response strictly matches `{ "message": "..." }`, preserving the response contract across all frontend callers.
  - **Zero Input Reflection:** All schema error messages are static string literals (e.g. `'Invalid email address'`, `'Name cannot exceed 100 characters'`, `'Password cannot exceed 72 bytes'`). Schemas **never** interpolate user-submitted values into error messages. Raw passwords, tokens, and untrusted inputs are never reflected in client responses or server console logs.

---

### 3.6 Design Question 6 — Unknown Fields Policy Per Endpoint
- **Policy Decision Matrix:**

| Schema | Target Endpoint | Strategy | Rationale |
|---|---|---|---|
| `authSchemas.registerBodySchema` | `POST /api/auth/register` | `.strip()` (Zod default) | Prevents mass-assignment (e.g. `role: 'admin'`, `isOperational: true`). Discards unmodeled fields while tolerating benign browser autofill extensions. |
| `authSchemas.loginBodySchema` | `POST /api/auth/login` | `.strip()` | Discards auxiliary metadata (e.g. `rememberMe`, `captchaToken`) without failing legitimate login requests. |
| `resumeSchemas.createResumeBodySchema` | `POST /api/resumes` | `.strip()` | Multipart parsing by Multer may attach boundary tokens or extra form fields. Stripping discards extraneous properties and supplies only `companyName`, `jobTitle`, `jobDescription`. |
| `resumeSchemas.resumeIdParamSchema` | `/:id` route parameters | Non-strict object | Validates `id` strictly against the 24-hex rule while avoiding breaking on unrelated route parameters or merged router params. |
| `commonSchemas.objectIdParamSchema` | Generic `/:id` parameters | Non-strict object | Validates `id` strictly against 24-hex rule without interfering with unrelated route params. |

---

### 3.7 Design Question 7 — Multipart Upload Ordering & External Call Isolation
- **Middleware Execution Flow in `server/routes/resumeRoutes.js`:**
  ```text
  Client Request
       │
       ▼
  1. auth middleware
     - Verifies JWT cookie
     - Rejects unauthenticated requests with 401
     - Sets req.userId
       │
       ▼
  2. uploadResumeFile (Multer memoryStorage)
     - Parses multipart/form-data stream
     - Enforces 10MB file size limit (rejects with 400 if exceeded)
     - Enforces PDF extension/mimetype (rejects with 400 if invalid)
     - Populates req.file (in-memory Buffer) and req.body (text fields)
       │
       ▼
  3. validate({ body: createResumeBodySchema }) (Zod Validation)
     - Validates companyName (required, 1-100 chars)
     - Validates jobTitle (required, 1-100 chars)
     - Validates jobDescription (optional, max 20,000 chars)
     - If text validation FAILS:
       - Calls next(new AppError(formattedMessage, 400))
       - Request terminates immediately in errorHandler
       - Controller is NEVER reached
       │ (Valid text fields only)
       ▼
  4. createResume controller
     - Verifies %PDF- magic bytes on req.file.buffer
     - Calls cloudinaryService.uploadPdfBuffer(req.file.buffer)
     - Saves record to MongoDB via Resume.create(...)
  ```
- **External Service Isolation Guarantee:**
  - Because `validate` runs **before** `createResume`, requests with missing, empty, or oversized text fields are aborted at Step 3.
  - `cloudinaryService.uploadPdfBuffer` is **never called** for invalid text payloads. No orphaned Cloudinary assets are created, and no Cloudinary API quota is consumed.
  - For `POST /api/resumes/:id/analyze`, `validate({ params: resumeIdParamSchema })` runs before `analyzeResume`. Malformed IDs are aborted at 400, ensuring `aiService.analyzeResumeWithGemini` is **never called**.

---

### 3.8 Design Question 8 — Test Authenticity Strategy
- **Core Principle:** Do not rely solely on synthetic or dummy routes. Tests must mount and verify the actual production route configuration.
- **Mock Order Guarantee:**
  - All dependency mocks (`User`, `Resume`, `cloudinaryService`, `aiService`) are established **before** router modules are imported in `test_validation.js`.
  - Because Node caches CommonJS modules, controllers and routers imported after mocks will use the mocked service objects.
- **Test Architecture in `server/test_validation.js`:**
  1. **Schema Unit Tests:** Direct `safeParse` tests against exported schemas in `server/schemas/` covering:
     - Exact UTF-8 byte boundary with multi-byte unicode and emojis (`Buffer.byteLength`).
     - Minimum 6 characters vs. maximum 72 bytes on registration.
     - Login acceptance of passwords > 72 bytes.
     - Stripping of unmodeled body fields.
     - 24-character hex ObjectId matching and rejection of invalid characters.
  2. **Middleware Unit Tests:** Direct invocation of `validate.js` testing:
     - Explicit rejection of missing/null/primitive input (`target.data === undefined || target.data === null || typeof target.data !== 'object'`).
     - Conversion of Zod issues to clean, safe `AppError(msg, 400)`.
     - Non-reflection of submitted sensitive values.
     - Safe assignment of `req.body`, `req.params`, and `req.validated`.
  3. **Production Route Integration Tests:**
     - Spin up an in-memory Express instance mounting the actual production routers: [authRoutes.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js) and [resumeRoutes.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js) alongside [errorHandler.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/middleware/errorHandler.js).
     - Send real HTTP requests over the local loopback (`http.request` / `127.0.0.1:0`).
     - Verify that for multipart upload failures, the Cloudinary mock upload function is called **exactly 0 times**.
     - Verify that for analyze failures with invalid IDs, the Gemini mock analysis function and `Resume.findOne` are called **exactly 0 times**.
     - **Zero Live Infrastructure:** Tests run strictly in-memory with local mocks. No network calls to MongoDB Atlas, Cloudinary, or Google Gemini.
     - **Regression Baseline:** All 52 existing backend tests continue passing; frontend lint baseline is preserved.

---

### 3.9 Design Question 9 — Scope Boundary & Non-Goals
- **Strictly in Scope for Step 1.3:**
  - Creation of schema files: `server/schemas/commonSchemas.js`, `server/schemas/authSchemas.js`, `server/schemas/resumeSchemas.js`.
  - Creation of validation middleware: `server/middleware/validate.js`.
  - Route mounting in `server/routes/authRoutes.js` and `server/routes/resumeRoutes.js`.
  - Automated test suite in `server/test_validation.js` and `package.json` test script wiring.
- **Strictly Out of Scope (Deferred to Later Steps):**
  - **Step 1.4:** Rate limiting for auth and AI endpoints, quotas, and AI concurrency locking.
  - **Step 1.5:** CSRF defense tokens / custom headers, cookie `SameSite` cross-domain hardening.
  - **Step 1.6:** CI/CD GitHub Actions setup and end-to-end integration workflows.
  - **Controller Refactoring:** Controller business logic and database queries will remain intact; validation acts as an upfront filter.
  - **Deployment Actions:** No git stage, commit, push, or cloud deployment.

---

## 4. Detailed Implementation Specification

### 4.1 Schemas Directory Structure
```text
server/
  schemas/
    commonSchemas.js      <-- objectIdSchema, objectIdParamSchema
    authSchemas.js        <-- registerBodySchema, loginBodySchema
    resumeSchemas.js      <-- createResumeBodySchema, resumeIdParamSchema
  middleware/
    validate.js           <-- Higher-order request validation middleware
```

### 4.2 Schema Definitions

#### `server/schemas/commonSchemas.js`
```javascript
const { z } = require('zod');

// Standard 24-character hexadecimal MongoDB ObjectId
const objectIdSchema = z
  .string({ message: 'ID is required' })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

const objectIdParamSchema = z.object({
  id: objectIdSchema,
});

module.exports = {
  objectIdSchema,
  objectIdParamSchema,
};
```

#### `server/schemas/authSchemas.js`
```javascript
const { z } = require('zod');

const registerBodySchema = z
  .object({
    name: z
      .string({ message: 'Name is required' })
      .trim()
      .min(1, 'Name is required')
      .max(100, 'Name cannot exceed 100 characters'),

    email: z
      .string({ message: 'Email is required' })
      .trim()
      .min(1, 'Email is required')
      .email('Invalid email address')
      .max(254, 'Email cannot exceed 254 characters'),

    password: z
      .string({ message: 'Password is required' })
      .min(6, 'Password must be at least 6 characters long')
      .refine((val) => Buffer.byteLength(val, 'utf8') <= 72, {
        message: 'Password cannot exceed 72 bytes',
      }),
  })
  .strip();

const loginBodySchema = z
  .object({
    email: z
      .string({ message: 'Email is required' })
      .trim()
      .min(1, 'Email is required')
      .email('Invalid email address')
      .max(254, 'Email cannot exceed 254 characters'),

    password: z
      .string({ message: 'Password is required' })
      .min(1, 'Password is required')
      .max(1000, 'Password cannot exceed 1000 characters'),
  })
  .strip();

module.exports = {
  registerBodySchema,
  loginBodySchema,
};
```

#### `server/schemas/resumeSchemas.js`
```javascript
const { z } = require('zod');

const createResumeBodySchema = z
  .object({
    companyName: z
      .string({ message: 'Company name is required' })
      .trim()
      .min(1, 'Company name is required')
      .max(100, 'Company name cannot exceed 100 characters'),

    jobTitle: z
      .string({ message: 'Job title is required' })
      .trim()
      .min(1, 'Job title is required')
      .max(100, 'Job title cannot exceed 100 characters'),

    jobDescription: z
      .string()
      .trim()
      .max(20000, 'Job description cannot exceed 20000 characters')
      .optional()
      .default(''),
  })
  .strip();

const resumeIdParamSchema = z.object({
  id: z
    .string({ message: 'Resume ID is required' })
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid resume ID format'),
});

module.exports = {
  createResumeBodySchema,
  resumeIdParamSchema,
};
```

### 4.3 Validation Middleware (`server/middleware/validate.js`)
```javascript
const { AppError } = require('./errorHandler');

/**
 * Higher-order middleware factory for validating request components against Zod schemas.
 *
 * @param {object} schemas
 * @param {import('zod').ZodType} [schemas.body]
 * @param {import('zod').ZodType} [schemas.params]
 * @param {import('zod').ZodType} [schemas.query]
 * @returns {import('express').RequestHandler}
 */
const validate = ({ body, params, query }) => {
  return (req, res, next) => {
    const targets = [
      { name: 'body', schema: body, data: req.body, label: 'Request body' },
      { name: 'params', schema: params, data: req.params, label: 'Route parameters' },
      { name: 'query', schema: query, data: req.query, label: 'Query parameters' },
    ];

    if (!req.validated) {
      req.validated = {};
    }

    for (const target of targets) {
      if (!target.schema) continue;

      // Explicitly reject missing, null, or non-object input without silent {} masking
      if (
        target.data === undefined ||
        target.data === null ||
        typeof target.data !== 'object'
      ) {
        return next(new AppError(`${target.label} must be a valid object`, 400));
      }

      const result = target.schema.safeParse(target.data);

      if (!result.success) {
        // Extract clean field-level error messages without reflecting submitted values
        const errorMessages = result.error.issues.map((issue) => issue.message);

        const formattedMessage = errorMessages.length > 0
          ? errorMessages.join(', ')
          : 'Invalid request input';

        // Delegate cleanly to centralized errorHandler via AppError(message, 400)
        return next(new AppError(formattedMessage, 400));
      }

      // Store in dedicated validated container
      req.validated[target.name] = result.data;

      // Safely synchronize parsed/sanitized output back to Express request properties
      if (target.name === 'body') {
        req.body = result.data;
      } else if (target.name === 'params') {
        if (req.params && typeof req.params === 'object') {
          Object.assign(req.params, result.data);
        } else {
          req.params = result.data;
        }
      } else if (target.name === 'query') {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }

    next();
  };
};

module.exports = validate;
```

---

## 5. Route Integration Specification

### 5.1 Authentication Routes ([server/routes/authRoutes.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/authRoutes.js))
```javascript
const express = require('express');
const router = express.Router();
const { register, login, logout, me } = require('../controllers/authController');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { registerBodySchema, loginBodySchema } = require('../schemas/authSchemas');

router.post('/register', validate({ body: registerBodySchema }), register);
router.post('/login', validate({ body: loginBodySchema }), login);
router.post('/logout', logout);
router.get('/me', auth, me);

module.exports = router;
```

### 5.2 Resume Routes ([server/routes/resumeRoutes.js](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/server/routes/resumeRoutes.js))
```javascript
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const uploadResumeFile = require('../middleware/upload');
const validate = require('../middleware/validate');
const { createResumeBodySchema, resumeIdParamSchema } = require('../schemas/resumeSchemas');
const {
  createResume,
  getResumes,
  getResumeById,
  deleteResume,
  deleteAllResumes,
  analyzeResume,
} = require('../controllers/resumeController');

// All resume routes are protected by auth middleware
router.use(auth);

// Multipart flow: uploadResumeFile runs FIRST to parse multipart stream into req.file and req.body,
// followed immediately by validate({ body: createResumeBodySchema }) before controller execution.
router.post('/', uploadResumeFile, validate({ body: createResumeBodySchema }), createResume);
router.post('/:id/analyze', validate({ params: resumeIdParamSchema }), analyzeResume);
router.get('/', getResumes);
router.get('/:id', validate({ params: resumeIdParamSchema }), getResumeById);
router.delete('/:id', validate({ params: resumeIdParamSchema }), deleteResume);
router.delete('/', deleteAllResumes);

module.exports = router;
```

---

## 6. Expected File Changes

| File | Type | Proposed Changes |
|---|---|---|
| `server/schemas/commonSchemas.js` | New | Reusable `objectIdSchema` and `objectIdParamSchema`. |
| `server/schemas/authSchemas.js` | New | `registerBodySchema` (UTF-8 byte length, min 6) and `loginBodySchema`. |
| `server/schemas/resumeSchemas.js` | New | `createResumeBodySchema` and `resumeIdParamSchema`. |
| `server/middleware/validate.js` | New | Generic validation middleware dispatching safe `AppError(message, 400)`. |
| `server/routes/authRoutes.js` | Modified | Mount `validate` middleware on `/register` and `/login`. |
| `server/routes/resumeRoutes.js` | Modified | Mount `validate` middleware on `POST /`, `POST /:id/analyze`, `GET /:id`, `DELETE /:id`. |
| `server/test_validation.js` | New | Comprehensive automated integration suite for all validation scenarios. |
| `server/package.json` | Modified | Add `"test:validation": "node test_validation.js"` and chain into `"test"`. |

---

## 7. Automated Test Plan & Verification Matrix

Create `server/test_validation.js` following the native HTTP test runner pattern established in `test_error_handling.js`.

### Test Cases Planned:
1. **Schema Unit Tests:**
   - Registration password of 6 characters passes.
   - Registration password of 5 characters fails with `'Password must be at least 6 characters long'`.
   - Registration password with 18 emojis (36 UTF-16 code units, 72 UTF-8 bytes) passes.
   - Registration password with 19 emojis (38 UTF-16 code units, 76 UTF-8 bytes) fails with `'Password cannot exceed 72 bytes'`.
   - Login password with > 72 bytes passes (backward compatibility for previously registered users).
   - Valid 24-character hexadecimal ObjectId passes.
   - 24-character string with non-hex characters (e.g. ending in 'g') fails with `'Invalid resume ID format'`.
   - 12-byte string fails with `'Invalid resume ID format'`.
   - Stripping of undeclared body properties.
2. **Registration Endpoint Integration:**
   - Valid payload returns HTTP 201 (mocked DB).
   - Missing `name` returns 400 with `'Name is required'`.
   - Empty/whitespace `name` returns 400 with `'Name is required'`.
   - Name exceeding 100 characters returns 400 with `'Name cannot exceed 100 characters'`.
   - Missing `email` returns 400 with `'Email is required'`.
   - Malformed `email` returns 400 with `'Invalid email address'`.
   - Missing `password` returns 400 with `'Password is required'`.
   - Short `password` (< 6 chars) returns 400 with `'Password must be at least 6 characters long'`.
   - Byte-oversized `password` (> 72 UTF-8 bytes) returns 400 with `'Password cannot exceed 72 bytes'`.
   - Injected extra fields (e.g. `role: "admin"`) are stripped from `req.body`.
3. **Login Endpoint Integration:**
   - Valid login payload returns HTTP 200 (mocked DB).
   - Missing email returns 400 with `'Email is required'`.
   - Malformed email returns 400 with `'Invalid email address'`.
   - Missing password returns 400 with `'Password is required'`.
   - Login with password > 72 bytes proceeds to authentication rather than 400 rejection.
4. **Resume Creation & Multipart Integration:**
   - Valid PDF upload with valid fields returns HTTP 201 (mocked Cloudinary).
   - Valid PDF upload with missing `companyName` returns 400 with `'Company name is required'`.
   - **Crucial Assertion:** For missing `companyName`, `cloudinaryService.uploadPdfBuffer` is called **exactly 0 times**.
   - Valid PDF upload with missing `jobTitle` returns 400 with `'Job title is required'`.
   - Valid PDF upload with `jobDescription` > 20,000 characters returns 400.
   - **Crucial Assertion:** For oversized `jobDescription`, `cloudinaryService.uploadPdfBuffer` is called **exactly 0 times**.
5. **Route Parameter Validation (`:id`):**
   - `GET /api/resumes/:id` with valid 24-hex ID returns 200 (mocked DB).
   - `GET /api/resumes/:id` with non-hex ID returns 400 with `'Invalid resume ID format'`.
   - **Crucial Assertion:** For non-hex ID, `Resume.findOne` is called **exactly 0 times**.
   - `DELETE /api/resumes/:id` with non-hex ID returns 400 with `'Invalid resume ID format'`.
   - `POST /api/resumes/:id/analyze` with non-hex ID returns 400 with `'Invalid resume ID format'`.
   - **Crucial Assertion:** For non-hex ID, `aiService.analyzeResumeWithGemini` is called **exactly 0 times**.
6. **Security & Non-Disclosure Assertions:**
   - Injected dummy password (`SUPER_SECRET_USER_PASSWORD_XYZ99`) in validation error is **NEVER** reflected in 400 JSON response or server console logs.
   - Injected dummy token or authorization header is **NEVER** reflected in validation responses.
7. **Regression Invariants:**
   - `npm --prefix server test` runs all suites (`test_env.js`, `test_retry.js`, `test_error_handling.js`, `test_validation.js`) and must achieve 100% pass rate (target: 52 existing + ~25 validation = ~77 tests).
   - `npm --prefix client run lint` must report 0 errors and preserve 15 pre-existing warnings.

---

## 8. Compatibility Risks & Mitigations

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| **Password Min Length (6 vs 8)** | If backend requires 8, users entering 6–7 chars in existing frontend register form experience unexpected 400 errors. | Set backend Zod schema to `min(6)` to maintain 100% parity with [RegisterPage:L41](file:///c:/Users/anuj%20chahar/OneDrive/Desktop/Projects/resume-analyser/client/app/auth/register/page.jsx#L41). |
| **Bcrypt Byte Truncation vs JS Length** | Multi-byte characters (emojis) exceed 72 bytes even when JS length is small (< 40). | Use `.refine((v) => Buffer.byteLength(v, 'utf8') <= 72)` on registration. |
| **Login Lockout for Existing Users** | Enforcing 72-byte or 6-char rule on login could lock out previously registered users. | Keep login password schema flexible: `min(1)` and generous upper bound (`max(1000)`). |
| **Zod v4 API Differences** | Zod v4 ignores `{ required_error: ... }` and uses `issues` instead of `errors`. | Strictly use `{ message: ... }` options and read `result.error.issues`. |
| **Express 5 `req.query` Getter** | Reassigning `req.query = ...` throws TypeError in strict mode. | Use `Object.defineProperty` for query parameters, `Object.assign` for params, and `req.body = ...`. |
| **Missing/Falsy Payload Masking** | Using `data || {}` silently converts null/missing payloads to empty objects. | Explicitly check `target.data === undefined || target.data === null || typeof target.data !== 'object'`. |
| **Route Param Strictness Conflicts** | Adding `.strict()` to route params breaks routes if parent router merges params or attaches route properties. | Avoid `.strict()` on `resumeIdParamSchema` and `objectIdParamSchema`. |
| **Multipart Parsing Order** | If `validate` runs before Multer on `POST /api/resumes`, `req.body` is empty and creation fails. | Explicitly mount `uploadResumeFile` before `validate({ body: createResumeBodySchema })` in `resumeRoutes.js`. |
| **ID Parameter Error Text Parity** | Existing tests in `test_error_handling.js` check for `'Invalid resume ID format'`. | In `resumeIdParamSchema`, use the exact string `'Invalid resume ID format'`. |
| **Orphan Cloudinary / Gemini Invocations** | Malformed requests incurring external billing or orphan assets. | Middleware halts invalid requests at 400 before controllers or cloud services are invoked. |

---

## 9. Step 1.3 Implementation Phases

To ensure reviewable, safe progression once authorized:

```mermaid
graph LR
    P1[Phase 1: Schemas] --> P2[Phase 2: Middleware]
    P2 --> P3[Phase 3: Route Wiring]
    P3 --> P4[Phase 4: Tests & Verification]
```

- **Phase 1: Zod Schemas:** Define `commonSchemas.js`, `authSchemas.js`, and `resumeSchemas.js`.
- **Phase 2: Validation Middleware:** Implement `middleware/validate.js` integrating with `AppError(message, 400)` and explicit non-object checking.
- **Phase 3: Route Integration:** Wire `validate` into `authRoutes.js` and `resumeRoutes.js`.
- **Phase 4: Test Suite & Regression:** Create `test_validation.js`, update `server/package.json`, and run full test suite and client linter.

---

## 10. Acceptance Criteria for Step 1.3

- [ ] All 4 schema and middleware files are implemented cleanly without external network dependencies.
- [ ] Invalid registrations (bad email, short password, missing name, >72 UTF-8 bytes) return HTTP 400 with clean, non-sensitive messages.
- [ ] Invalid logins return HTTP 400 without revealing internal credentials.
- [ ] Valid logins with passwords > 72 bytes are not rejected at the validation layer.
- [ ] Invalid resume IDs (`:id`) in get, delete, and analyze routes return HTTP 400 before touching MongoDB.
- [ ] Oversized resume payloads (`companyName > 100`, `jobDescription > 20000`) are rejected at the boundary.
- [ ] Multipart resume PDF uploads with invalid text fields abort at 400 and call Cloudinary upload 0 times.
- [ ] Validation errors never echo submitted passwords, tokens, or raw error stacks.
- [ ] All 52 existing backend tests continue to pass.
- [ ] The new validation test suite achieves a 100% pass rate.
- [ ] Client lint passes with zero errors and zero regressions.
- [ ] No changes to application code or tests occur until explicit user approval is granted.
