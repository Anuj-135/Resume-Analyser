# Resume Analyser --- Implementation Plan

**Repository:** https://github.com/Anuj-135/Resume-Analyser
**Live application:** https://resume-analyser-sooty-delta.vercel.app
**Status:** Phase 1 closed with documented limitations ---
Phase 2 awaiting authorization\
**Workflow:** Inspect → document findings → propose changes → request
approval → implement one phase at a time → test → review

------------------------------------------------------------------------

## 1. Purpose and goals

This plan consolidates the proposed improvements for the Resume Analyser
into a repository-specific, testable workflow. The goal is to improve
security, production reliability, AI-analysis quality, data integrity,
user experience, and project presentation without rewriting the existing
architecture unnecessarily.

Current intended architecture:

-   **Frontend:** Next.js / React, deployed on Vercel
-   **API:** Node.js / Express, deployed on Render
-   **Database:** MongoDB Atlas
-   **Resume file storage:** Cloudinary (verify all active paths use
    persistent storage)
-   **AI analysis:** Gemini API

Treat this architecture as the current design, not as proof that every
deployment setting or code path is correct. Verify against the current
`main` branch and deployed environment before making changes.

## 2. Non-negotiable workflow and approval gate

1.  **Do not edit application code during the initial investigation.**
2.  Inspect the current repository and identify the active code paths.
    Do not assume earlier review notes still match the latest branch.
3.  For each item, assign one status:
    -   **Confirmed missing**
    -   **Partially implemented**
    -   **Already implemented**
    -   **Needs production verification**
    -   **Not applicable / defer**
4.  Record evidence: file path, relevant function/route/config, current
    behavior, risk, and how to reproduce or test it.
5.  Update this plan with the findings and a proposed implementation
    sequence.
6.  Report any environment-variable, deployment, schema, data migration,
    cost, or breaking-change implications.
7.  **Stop and request explicit user approval before changing
    application code, dependencies, deployment settings, or data.**
8.  After approval, implement one phase at a time. Run the phase's
    tests, inspect the diff, report results and unresolved risks, and
    wait for approval before moving to the next phase.
9.  Never print, commit, or include secret values in reports. Refer to
    secret names only.

## 3. Investigation pass --- complete before implementation

### 3.1 Repository and deployment baseline

-   [ ] Confirm current branch, commit SHA, working-tree status, and
    package-manager lockfiles.
-   [ ] Inspect root, `client/`, and `server/` scripts, dependencies,
    lint/build/test commands, and deployment configuration.
-   [ ] Identify active frontend API base URL configuration and all
    production API calls.
-   [ ] Identify active Render start/build commands, health checks,
    persistent disk settings (if any), and runtime version.
-   [ ] Identify Vercel environment-variable names and
    production/preview differences without revealing values.
-   [ ] Check whether CI exists and which checks it runs.
-   [ ] Run baseline lint, build, and existing tests where feasible;
    record exact commands and outcomes.
-   [ ] Verify the live site manually for registration/login, upload,
    analysis, history, download/view, deletion, logout, and
    refresh/session restoration. Record browser, timestamp, expected
    behavior, actual behavior, and sanitized errors.
-   [ ] Do not claim a behavior is production-verified unless it was
    actually tested against the deployed app.

### 3.2 File upload and storage audit

-   [ ] Search the whole repository for `server/uploads`, `uploads/`,
    `multer.diskStorage`, `diskStorage`, `writeFile`,
    `createWriteStream`, temporary-file handling, and legacy upload
    code.
-   [ ] Trace the complete active upload flow from route → middleware →
    controller → Cloudinary/storage helper → MongoDB record.
-   [ ] Confirm no production upload path relies on Render's ephemeral
    filesystem.
-   [ ] Confirm the uploaded asset can be retrieved after an application
    restart/redeploy (use a safe test account and disposable test PDF).
-   [ ] Verify file type, extension, MIME type, PDF magic-byte,
    file-size, and malformed-PDF handling.
-   [ ] Check that temporary files and buffers are released and failures
    do not leave orphaned storage assets.
-   [ ] Trace delete-one and delete-all behavior across MongoDB and
    Cloudinary.
-   [ ] Determine whether legacy local files or database records need a
    migration. Do not delete existing files as part of investigation.
-   [ ] Confirm private files are not publicly accessible and signed
    links expire as intended.

**Decision:** Keep Cloudinary if it already meets the requirements. Do
not add S3/R2 solely for novelty. Change providers only if a concrete
reliability, cost, compliance, or capability requirement justifies it.

### 3.3 Authentication, cookies, and authorization audit

-   [ ] Trace register, login, logout, current-user/session restoration,
    and every protected route.
-   [ ] Confirm password hashing, JWT signing/verification, expiry,
    secret validation, and safe error responses.
-   [ ] Confirm production cookies use `httpOnly`, `Secure`, and the
    appropriate `SameSite` setting for the deployed topology. Cross-site
    frontend/API cookies generally require `SameSite=None; Secure`, but
    browser third-party-cookie restrictions can still block them.
-   [ ] Verify CORS origin allow-list and `credentials` configuration
    for production, preview, and local development.
-   [ ] Check CSRF exposure for cookie-authenticated state-changing
    routes. CORS is not a complete CSRF defense.
-   [ ] Verify every resume operation scopes access to the authenticated
    owner, including analyze, download/view, and bulk/single deletion.
-   [ ] Check registration uniqueness enforcement at both application
    and database levels.
-   [ ] Search for rate limiting, brute-force protections, Helmet,
    schema validation, and security headers in active middleware/routes.
-   [ ] Test Chrome and Safari. If feasible, test Safari's cross-site
    tracking protections and Chrome with third-party cookies restricted.
    Do not assume cookie flags alone guarantee authentication will work.
-   [ ] Consider a same-site deployment arrangement (for example,
    proxying the API under the frontend's site) if restrictive browser
    policies make cross-site cookie auth unreliable.

### 3.4 AI service audit

-   [ ] Trace the analysis route through service, provider SDK, prompt,
    response parser/schema, database persistence, and frontend
    rendering.
-   [ ] Compare README model names, code defaults/fallbacks, and
    deployed `GEMINI_MODEL` configuration. Confirm the chosen model is
    available for the actual API account.
-   [ ] Inspect retry behavior: eligible error classes, maximum
    attempts, exponential backoff/jitter, `Retry-After`, timeout, and
    total request deadline.
-   [ ] Verify fallback model behavior and ensure it does not retry
    permanent errors such as invalid credentials or malformed requests.
-   [ ] Check rate-limit handling and Gemini quota/cost exposure.
-   [ ] Validate AI output against a schema and verify scores are finite
    and within documented bounds.
-   [ ] Check duplicate concurrent analysis requests and repeated-click
    behavior.
-   [ ] Determine typical and worst-case latency and whether a
    synchronous request risks gateway/request timeouts.
-   [ ] Check prompt-injection handling: resume/job-description content
    must be treated as untrusted input, not as instructions that
    override system behavior.
-   [ ] Review logs to ensure resume text, credentials, and other
    sensitive data are not logged unnecessarily.
-   [ ] Determine whether background processing is warranted from
    measured latency and platform request limits rather than adding a
    queue by default.

### 3.5 Data, runtime, and operational audit

-   [ ] Inspect MongoDB schemas, indexes, ownership fields, and query
    patterns.
-   [ ] Check for pagination or unbounded resume-history queries.
-   [ ] Review file/record consistency when Cloudinary or MongoDB
    operations partially fail.
-   [ ] Inspect request body limits, upload limits, PDF parsing limits,
    extracted-text limits, concurrency limits, and outbound fetch
    timeouts.
-   [ ] Confirm required environment variables are validated at startup
    without logging values.
-   [ ] Inspect centralized error handling and ensure production
    responses do not expose stack traces or provider internals.
-   [ ] Check dependency versions and known security alerts.
-   [ ] Check repository history and current files for accidentally
    committed secrets or private resumes. If a secret was exposed,
    rotate it; deleting a file from the latest commit alone does not
    revoke a secret.
-   [ ] Review user data deletion and retention behavior.

### 3.6 Frontend and documentation audit

-   [ ] Walk through all critical user journeys at mobile, tablet, and
    desktop widths.
-   [ ] Check loading, empty, validation, network-error, AI-error,
    expired-session, and success states.
-   [ ] Check keyboard navigation, focus indicators, accessible labels,
    contrast, semantic headings, and screen-reader announcements.
-   [ ] Check whether the result screen explains score meaning,
    evidence, limitations, and actionable changes.
-   [ ] Verify the live URL and take a real screenshot of the current
    results dashboard for the README.
-   [ ] Review README setup instructions, environment-variable names,
    scripts, architecture, deployment instructions, limitations, and
    troubleshooting.
-   [ ] Inspect GitHub About metadata (description, website, topics) and
    `.gitignore`.
-   [ ] Check whether a license is present; do not choose one
    automatically without the owner's intent.

## 4. Implementation phases

Implement only items confirmed missing or inadequate during the
investigation. If a feature is already correctly implemented, retain it
and add/repair tests rather than duplicating it.

### Phase 1 --- Security and abuse prevention

**Goal:** Reduce account compromise, unauthorized access, API abuse, and
unexpected AI spending.

**Status:** Phase 1 is formally closed with documented limitations
(not every acceptance criterion is fully verified). The previously
reported baseline was 186 passing automated tests; the suite was not
independently rerun during final roadmap synchronization. Cross-browser
cookie testing on Safari and Firefox is deferred and does not block
Phase 2.

-   [x] Add or verify Helmet with a deliberate security-header
    configuration. Configure CSP carefully for the actual
    frontend/backend architecture and required external resources.
    *(Verified in server/server.js and tests/test_error_handling.js).*
-   [x] Add or verify Zod validation for request bodies, route
    parameters, query parameters, and environment variables.
    *(Verified in server/schemas/ and tests/test_validation.js,
    tests/test_env.js).*
-   [x] Add rate limits to login and registration, with appropriate
    per-IP controls and careful handling of shared IPs.
    *(Implementation/configuration: loginLimiter and registerLimiter
    are configured in server/middleware/rateLimiter.js with 10 req/15 min
    thresholds and /56 IPv6 subnet keying. Automated boundary coverage:
    previously reported isolated tests in tests/test_rate_limit.js
    verified the 10-request thresholds and 11th-request HTTP 429 responses.
    Production exhaustion: production rate-limit exhaustion was
    deliberately not tested. Test-isolation limitation: login and
    registration limiters lack explicit per-limiter resetKey() tests).*
-   [x] Add per-user and global limits for expensive AI analysis
    requests; include a clear 429 response and a sensible retry message.
    *(Implementation/configuration: analysisLimiter [5 req/hr per user]
    and globalAnalysisLimiter [50 req/hr process-wide] configured in
    server/middleware/rateLimiter.js with Draft-7 headers and Retry-After.
    Automated boundary coverage: previously reported isolated tests in
    tests/test_rate_limit.js and tests/test_http_429_retry.js verified
    thresholds, 429 responses, and client retry parsing. Production
    exhaustion: production rate-limit exhaustion was deliberately
    not tested; aggregate rate limits across multi-instance production
    deployments have not been exhaustively verified).*
-   [x] Validate required secrets at startup, including a sufficiently
    strong JWT secret. Never silently use an insecure production
    default. *(Verified in server/schemas/envSchema.js and
    tests/test_env.js).*
-   [x] Verify password hashing, JWT expiry, cookie attributes, CORS
    allow-list, and safe authentication error behavior.
    *(Implementation verified in authController.js, server.js,
    and tests/test_env.js; production cookie flags verified in
    deployed Chrome, while Safari and Firefox cross-site cookie
    behavior remain unverified).*
-   [x] Implement CSRF protection appropriate to cookie-based
    authentication and the actual origin/deployment setup.
    *(Verified via custom X-Requested-With header & origin check in
    server/middleware/csrf.js and tests/test_csrf.js).*
-   [x] Verify authorization/ownership checks for every resume route.
    *(Verified in resumeController.js and tests/test_authorization.js).*
-   [x] Enforce file and request limits; add defensive PDF
    parsing/extracted-text/concurrency bounds where missing.
    *(Verified in upload.js, resumeRoutes.js, tests/test_pdf_safeguards.js,
    tests/test_concurrency_guard.js).*
-   [x] Ensure error responses do not leak stack traces, secrets,
    storage URLs, or provider internals.
    *(Verified in errorHandler.js, tests/test_error_handling.js,
    tests/test_rate_limit.js).*
-   [x] Document new environment variables and deployment settings.
    *(Verified in .env.example, implementation_plan.md, and docs).*

**Tests / acceptance criteria**

-   [x] Invalid/missing fields return a consistent 400 response and do
    not reach business logic. *(Verified by tests/test_validation.js).*
-   [x] Repeated authentication attempts and excessive AI calls are
    throttled as designed. *(Automated boundary coverage: previously
    reported isolated tests in tests/test_rate_limit.js verified all
    six rate limiters at their configured thresholds and confirmed
    HTTP 429 transitions. Production exhaustion: production rate-limit
    exhaustion was deliberately not tested to protect live availability
    and prevent lockouts. Test-isolation limitation: login and registration
    limiters lack explicit per-limiter resetKey() tests; aggregate abuse
    resistance across multiple server instances is not verified).*
-   [x] Authenticated user A cannot read, analyze, download, or delete
    user B's resume. *(Verified by tests/test_authorization.js).*
-   [ ] Production cookie options are asserted by tests and verified in
    a deployed browser. *(Partially verified: Production cookie options
    and flags HttpOnly, Secure, SameSite=None, storage, session restoration,
    and transmission passed all 7 reported manual checks in deployed
    Google Chrome. Cross-browser cookie testing on Safari and Firefox is
    deferred and does not block Phase 2; this criterion remains
    unchecked until Safari and Firefox are actually tested).*
-   [x] Disallowed origins are rejected; allowed origins and
    credentialed requests work. *(Verified by tests/test_csrf.js and
    CORS preflight probe).*
-   [x] CSRF defenses reject forged state-changing requests under the
    selected design. *(Verified by tests/test_csrf.js and Tier B
    verification).*
-   [x] Oversized, malformed, and non-PDF uploads fail safely.
    *(Verified by tests/test_pdf_safeguards.js).*
-   [x] Production error responses contain no stack trace or secret
    values. *(Verified by tests/test_error_handling.js).*
-   [x] Existing valid registration/login/upload/analyze flows continue
    to work. *(Verified in local integration tiers and deployed
    Chrome checks; the previously reported baseline was 186 passing
    automated tests, and the suite was not independently rerun
    during final roadmap synchronization).*

### Phase 2 --- Persistent storage and data integrity

**Goal:** Ensure files and records survive deploys and failures do not
leave inconsistent state.

-   [ ] Remove any active local-disk upload path from production, if
    found.
-   [ ] Standardize the upload path on Cloudinary or another chosen
    persistent object store.
-   [ ] Keep private file access authenticated and signed URLs
    short-lived.
-   [ ] Define behavior for upload-success/database-failure and
    database-delete/storage-delete partial failures.
-   [ ] Add retryable cleanup or a reconciliation process for orphaned
    storage assets if needed.
-   [ ] Verify single-delete and bulk-delete semantics.
-   [ ] Add pagination for resume history if queries are unbounded.
-   [ ] Review database indexes and uniqueness constraints.
-   [ ] If legacy local files exist, prepare a separate, backed-up
    migration plan with counts, integrity checks, and rollback
    instructions. Do not mix migration with routine code changes.

**Tests / acceptance criteria**

-   [ ] Uploaded files remain retrievable after a Render
    restart/redeploy test.
-   [ ] Upload/database failure scenarios leave no untracked asset, or
    create a recorded retryable cleanup task.
-   [ ] Delete behavior is deterministic when either MongoDB or
    Cloudinary fails.
-   [ ] Private assets cannot be accessed through an unintended public
    URL.
-   [ ] User A cannot access user B's file using a guessed or copied
    resume ID.
-   [ ] Pagination returns stable, correctly scoped results.
-   [ ] Migration, if required, is dry-run tested and has a documented
    rollback.

### Phase 3 --- AI reliability and controlled processing

**Goal:** Make analysis predictable, recoverable, and cost-aware.

-   [ ] Align the model configuration, code fallback, README, and
    production environment variable. Verify actual model availability
    before rollout.
-   [ ] Implement bounded retries with exponential backoff and jitter
    for transient errors; respect provider retry guidance.
-   [ ] Add request timeouts and an overall deadline.
-   [ ] Add a fallback model only for eligible errors and document
    differences in output.
-   [ ] Validate AI output using a strict schema; reject invalid scores
    and missing required fields.
-   [ ] Prevent duplicate concurrent analysis work for the same resume.
-   [ ] Record safe operational metrics such as duration, model,
    attempts, status, and usage/cost where available.
-   [ ] Add clear handling for empty or unextractable PDF text.
-   [ ] Decide whether to add a background queue after measuring latency
    and checking Render constraints. If approved, define durable job
    state, retry policy, status endpoint, polling interval, failure
    recovery, and duplicate-job behavior before coding.
-   [ ] Create an evaluation set of representative resumes/job
    descriptions to compare output quality, stability, latency, and
    cost.
-   [ ] Review prompt construction for untrusted resume/job-description
    text.

**Tests / acceptance criteria**

-   [ ] Transient errors retry only up to the configured limit.
-   [ ] Permanent errors do not trigger pointless retries.
-   [ ] Fallback is used only under documented conditions.
-   [ ] Invalid model output is handled safely and does not corrupt
    stored feedback.
-   [ ] Concurrent duplicate requests do not create uncontrolled
    duplicate paid calls.
-   [ ] Client receives clear progress, success, and failure states.
-   [ ] No sensitive resume content or secrets are emitted in
    operational logs.
-   [ ] Model evaluation results are recorded before switching the
    production default.

### Phase 4 --- Automated tests and CI/CD

**Goal:** Catch regressions before they reach production.

-   [ ] Standardize test scripts and document a clean install/test
    workflow.
-   [ ] Add unit and integration tests for auth, authorization, upload
    validation, storage, analysis, and failure paths.
-   [ ] Mock Gemini and Cloudinary in routine tests so CI does not
    depend on paid/live services.
-   [ ] Add frontend tests for key flows and result/error rendering.
-   [ ] Add GitHub Actions checks for lint, build, tests, and any
    relevant static checks.
-   [ ] Add dependency and secret scanning using suitable repository
    tooling.
-   [ ] Add a health endpoint and deployment checks without exposing
    sensitive diagnostics.
-   [ ] Keep a small, explicit smoke-test checklist for production
    releases.

**Tests / acceptance criteria**

-   [ ] A clean CI run passes without production secrets or paid API
    calls.
-   [ ] Tests cover both success paths and key failure paths.
-   [ ] Build and lint pass from the documented commands.
-   [ ] Failed checks block merging according to repository policy.
-   [ ] Production smoke tests verify the frontend/API integration after
    deployment.

### Phase 5 --- Frontend UX, accessibility, and browser compatibility

**Goal:** Make the application understandable and reliable for
first-time users.

-   [ ] Improve upload, analysis, and page-loading feedback.
-   [ ] Improve errors for network failures, invalid files, rate limits,
    expired sessions, and AI provider outages.
-   [ ] Ensure results prioritize score explanation, strengths,
    weaknesses, evidence, and actionable edits.
-   [ ] Add clear empty states and prevent accidental deletion.
-   [ ] Verify responsive layouts and keyboard accessibility.
-   [ ] Verify browser-specific cookie/session behavior, especially
    Safari and restrictive third-party-cookie settings.
-   [ ] If cross-site cookies remain unreliable, evaluate a same-site
    API/proxy deployment design before introducing fragile client-side
    workarounds.
-   [ ] Check that refresh/navigation does not lose valid session state
    or unsaved work unexpectedly.

**Tests / acceptance criteria**

-   [ ] Critical user journeys pass on desktop and mobile layouts.
-   [ ] Login, refresh, protected navigation, and logout work in
    supported browsers.
-   [ ] Loading and error states are visible and actionable.
-   [ ] Core controls work with keyboard navigation and have accessible
    labels.
-   [ ] No major layout breakage on the results dashboard at common
    viewport widths.

### Phase 6 --- README and repository polish

**Goal:** Make the repository easy for recruiters and developers to
evaluate and run.

-   [ ] Add the live demo link near the top of README.
-   [ ] Add a concise project summary and feature list.
-   [ ] Add a real screenshot of the results dashboard, ensuring it
    contains no personal resume data, tokens, or private information.
-   [ ] Add an architecture diagram showing frontend, API, database,
    file storage, and AI provider.
-   [ ] Document prerequisites, install steps, development commands,
    test commands, and environment-variable names.
-   [ ] Document deployment configuration, CORS/cookie expectations,
    file storage, and model configuration.
-   [ ] Document limitations, including scanned-PDF/OCR support and
    score interpretation.
-   [ ] Add a useful GitHub About description, website link, and
    relevant topics.
-   [ ] Review `.gitignore`, sample environment files, committed
    artifacts, and repository hygiene.
-   [ ] Add a license only if the owner chooses one.

**Acceptance criteria**

-   [ ] A new developer can follow the README to run the project without
    guessing missing steps.
-   [ ] README live link resolves to the intended deployment.
-   [ ] Screenshot is current and contains no private data.
-   [ ] No real secret values appear in documentation or sample files.

### Phase 7 --- Product differentiation (defer until core reliability is complete)

Potential improvements; do not begin until earlier phases are stable and
approved.

-   [ ] Resume-version comparison and improvement history.
-   [ ] Downloadable analysis reports.
-   [ ] More job-specific tailoring grounded in the user's actual
    experience.
-   [ ] Application/analysis trend insights where meaningful.
-   [ ] Clear privacy, retention, and deletion controls.
-   [ ] Operational dashboard for latency, failures, analysis volume,
    and estimated cost.

For each feature, write a short problem statement, expected user
benefit, privacy/cost implications, and acceptance criteria before
implementation.

## 5. Cross-cutting test strategy

Use the appropriate layers rather than relying only on manual testing:

-   **Unit tests:** validation, utility functions, schema parsing,
    scoring/output normalization, retry classification.
-   **Integration tests:** Express routes, auth middleware, database
    ownership filters, upload/storage service boundaries.
-   **Frontend tests:** forms, loading/error states, session
    restoration, results display, destructive actions.
-   **End-to-end smoke tests:** register/login → upload → analyze → view
    history/result → delete → logout.
-   **Browser checks:** Chrome and Safari, including restrictive cookie
    settings where feasible.
-   **Deployment checks:** correct API URL, CORS, cookies, storage,
    database connectivity, model configuration, and health endpoint.
-   **Failure injection:** provider timeout, rate limit, invalid AI
    response, Cloudinary failure, MongoDB failure, and concurrent
    requests.
-   **Security checks:** authorization boundaries, input limits, rate
    limiting, CSRF behavior, secret hygiene, and dependency scanning.

For each test, record the command or reproducible steps, expected
result, actual result, and status. Never mark a test as passed merely
because the code appears correct.

## 6. Release and rollback checklist

Before deploying each phase:

-   [ ] Review the diff for unrelated changes, secrets, debug output,
    and accidental file deletions.
-   [ ] Run the phase's tests plus the existing regression suite.
-   [ ] Confirm all required environment-variable changes and update
    deployment configuration deliberately.
-   [ ] Check compatibility with existing stored resumes and user
    records.
-   [ ] Document any database or storage migration and its rollback.
-   [ ] Deploy to a suitable preview/staging environment if available.
-   [ ] Run production smoke tests after deployment.
-   [ ] Monitor errors, rate limits, AI usage/cost, and storage
    behavior.
-   [ ] Keep a clear rollback path for code and configuration changes.

Do not make destructive data migrations or rotate production secrets as
part of a routine code change without a separate explicit plan. If a
secret is exposed, rotate it promptly and safely.

## 7. Definition of done

An item is complete only when:

1.  The original issue was confirmed or the reason for the change is
    documented.
2.  The implementation is reviewed and limited to the approved scope.
3.  Automated tests or reproducible manual checks pass.
4.  Security, privacy, deployment, and cost implications are addressed.
5.  Documentation and environment-variable examples are updated as
    needed.
6.  The diff and test results are reported to the user.
7.  No unrelated phase is started without approval.

## 8. Initial priority summary

1.  **Investigate first:** current storage path, auth/cookie behavior,
    existing middleware/validation/rate limits, AI retry/model
    configuration, and current test baseline.
2.  **Phase 1:** security and abuse prevention.
3.  **Phase 2:** persistent storage and data integrity, fixing only
    verified gaps.
4.  **Phase 3:** AI reliability and controlled processing.
5.  **Phase 4:** automated tests and CI/CD.
6.  **Phase 5:** frontend UX and browser compatibility.
7.  **Phase 6:** README and repository polish.
8.  **Phase 7:** optional differentiation features.

**Approval checkpoint:** After completing the investigation pass,
present the findings and a revised, evidence-based plan. Do not modify
application code until the user explicitly approves the proposed first
implementation phase.
