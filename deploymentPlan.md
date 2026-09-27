# Deployment Plan — Pre-Deployment Changes

This plan covers only the changes required to make the current codebase deployment-ready.
It does NOT cover actual hosting/platform setup (Vercel, Render, Atlas, Cloudinary account
creation, etc.) — that is a separate follow-up once these changes are done.

Work through sections in order. Each has a goal, a scope, and a definition of done —
confirm the current state of each item before changing it; several may already be
implemented correctly and only need verification, not a rewrite.

For each section, follow this workflow:
1. **Investigate** the current relevant files and report exactly what you find (quote the
   relevant code, don't just say "looks fine").
2. **Propose** the specific change needed, if any. If the item already meets the
   definition of done, say so explicitly and propose no change.
3. **Stop and wait for approval** before editing any file.
4. Only after approval, implement exactly what was proposed.

Do not skip ahead to a later section, and do not touch anything not described below.

---

## 1. File Storage Migration (local disk → Cloudinary)

**Why:** `server/uploads/` is local disk storage. Most deployment platforms use an
ephemeral or read-only filesystem — every uploaded PDF would be lost on the next
deploy, restart, or scale event, and "view PDF" links would break for existing resumes.

### 1.1 Existing Local Data Check (do this first, before any code change)

**Why:** Switching the storage backend without first checking what's already there can
leave existing database records pointing at files that are about to become unreachable,
with nobody having actually decided that was acceptable.

**Investigate:**
- How many files currently exist in `server/uploads/`?
- How many `Resume` documents in MongoDB reference a local file path, and do those paths
  still resolve to real files on disk?

**Report back before proposing any Section 1.2 change:** the counts above, and whether
this is disposable development/test data or something that needs to be preserved. Do not
assume either way — this is a decision for me to make, not to infer.

### 1.2 Storage & Access Migration

**Investigate:**
- Where PDFs are currently written (Multer config — likely `middleware/upload.js` or similar)
- Where the stored path is read back (analyze controller, PDF view/download route)
- Where a file is deleted (single-delete and wipe-all controllers)
- Whether resume thumbnails/images are also written to local disk anywhere
- Whether the current design assumes a resume's file is reachable by anyone who has its
  URL — this matters for Section 1.2's access-control requirement below, since a resume
  contains a name, contact details, and work history

**Scope:**
- Install `cloudinary` (and `multer` stays, but switch its storage engine from disk
  storage to memory storage)
- On upload: stream the in-memory file buffer to Cloudinary as a `raw` resource type
  (PDFs are not images, so they must be uploaded as `raw`, not `image`)
- **Access control — do not use Cloudinary's default public delivery.** A resume must
  not be viewable by anyone who merely has or guesses the URL. Upload using Cloudinary's
  `authenticated` (or `private`) delivery type instead of the default `upload` type, and
  generate a short-lived signed URL server-side (e.g. via `cloudinary.utils
  .private_download_url` or `cloudinary.url(..., { sign_url: true, type:
  'authenticated' })`) only at the moment a resume is actually requested — and only
  after the existing ownership check (the same check that already prevents one user
  from reading another user's resume record) has passed. Never store or return a
  permanent public URL.
- Update the `Resume` model: replace the local file path field with the Cloudinary
  `public_id` (used to generate a fresh signed URL on demand, and required for deletion)
- **Store `public_id` exactly as returned in the Cloudinary upload response** (e.g.
  `result.public_id`). Never reconstruct, guess, or derive it from the original
  filename, the MongoDB resume ID, or any other value — use the literal returned string,
  unmodified, everywhere it's needed later (signed URL generation and deletion alike).
- Update analyze logic to fetch/read the file content via Cloudinary instead of
  `fs.readFile`
- Update single-delete and wipe-all logic to delete the Cloudinary asset using
  the exact stored `public_id` and the same resource/delivery configuration
  used when the asset was uploaded. Verify the correct Cloudinary deletion
  parameters before implementing them; do not assume them from the filename
  or URL — in particular, `destroy()` requires both `resource_type` and `type`
  to match what was used at upload time (e.g. `raw` + `authenticated`), or it
  can silently fail to find the asset even with a correct `public_id`.
- Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` to
  `server/.env` (placeholders only — real values are added later, on the hosting platform)
- Keep all existing magic-byte and file-type validation exactly as it is — only the
  storage destination changes, not the validation in front of it

**Definition of done:** Uploading a resume stores it on Cloudinary as a private/authenticated
asset (confirm via the Cloudinary dashboard that it is NOT publicly accessible from a bare
URL), the resume can still be analyzed and viewed correctly by its owner, viewing it while
logged out or as a different user fails, and deleting a resume removes it from Cloudinary
using the exact stored `public_id` (confirm it's actually gone on the Cloudinary
dashboard, not just unlinked from the database).

---

## 2. Cross-Origin Cookie & CORS Configuration

**Why:** Once the client and server are on different production domains, the session
cookie needs stricter settings than local development, or the browser will silently
refuse to send it and every authenticated request will look logged-out.

**Investigate:**
- The exact cookie options used when the JWT is set (in the auth controller) — specifically
  `httpOnly`, `secure`, and `sameSite`
- The `cors()` configuration in `server.js` — confirm `origin` reads from
  `process.env.CLIENT_URL` (not hardcoded) and `credentials: true` is set
- The `withCredentials` setting on the client's Axios instance

**Scope (only if not already correct):**
- Cookie options should branch on environment: `secure: process.env.NODE_ENV ===
  'production'`, `sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'`
- `cors({ origin: process.env.CLIENT_URL, credentials: true })` — confirm this, do not
  hardcode a production URL into the code itself; it comes from the env var

**Definition of done:** Report the exact current cookie options and CORS config back to
me, with a clear statement of whether they already meet the above or need a change.

---

## 3. MongoDB Atlas Readiness

**Why:** The app currently points at a local MongoDB instance. Production needs a
reachable, managed database.

**Investigate:** Confirm `server/config/db.js` reads the connection string exclusively
from `process.env.MONGODB_URI`, with no hardcoded fallback to `localhost`.

**Scope:** This is expected to require no code change — only confirmation. If a
hardcoded fallback exists, remove it so a missing env var fails loudly instead of
silently connecting to the wrong database.

**Definition of done:** Confirmed (or fixed) that the connection string has a single
source of truth: the environment variable.

---

## 4. Secrets & Environment Variables Audit

**Why:** Every secret must come from the hosting platform's environment configuration,
never from a committed file.

**Investigate:** List every environment variable currently read by the server
(`JWT_SECRET`, `JWT_EXPIRES_IN`, `GEMINI_API_KEY`, `MONGODB_URI`, `CLIENT_URL`, `PORT`,
plus the new Cloudinary variables from Section 1) and confirm none has a hardcoded
fallback value containing a real-looking secret anywhere in the codebase.

**Scope:** No code change expected beyond what Section 1 already adds. This is a
verification pass — report back a complete list of required env vars for both `client/`
and `server/`, so I have the exact list to populate on the hosting platform later.

**Definition of done:** A complete, accurate list of every environment variable each app
needs in production, with none of them containing a real secret in the repo itself.

---

## 5. Production Start Script & Port Binding

**Why:** Hosting platforms run `npm start`, not `npm run dev`, and assign their own port
at runtime.

**Investigate:**
- Does `server/package.json` have a `"start": "node server.js"` script?
- Does `server.js` call `app.listen(process.env.PORT || 5000, ...)`, or is the port
  hardcoded?

**Scope:** Add the missing script and/or fix the port binding if either is missing.

**Definition of done:** `npm start` (not `npm run dev`) successfully runs the server
locally, and the listening port is read from `process.env.PORT`.

---

## 6. Final Hygiene Checks

**Investigate and report, fixing anything that fails:**
- Check which `.gitignore` file(s) actually exist — most likely a separate
  `client/.gitignore` and `server/.gitignore`, possibly also a root-level `.gitignore`.
  Patterns are relative to the location of the `.gitignore` file itself, so get the
  scope right for each: inside `server/.gitignore`, the uploads folder must be listed as
  `uploads/`, NOT `server/uploads/` — the `server/` prefix is only correct if that
  pattern instead lives in a root-level `.gitignore`. Confirm each file's patterns match
  its own location rather than being copy-pasted from the wrong scope.
- `client/.gitignore` excludes `node_modules/`, `.env`, and `.env.local`
- `server/.gitignore` excludes `node_modules/` and `.env`
- `cd client && npm run build` completes with no errors
- A full-text search for `localhost` across `client/` and `server/` (excluding
  `node_modules`). For each match, report whether it's part of production runtime
  configuration (must be fixed to use an environment variable) or an intentional
  dev/test-only reference (e.g. a local-dev fallback default, or a test file's base
  URL) — leave the latter in place, but state explicitly why each one is safe to keep

**Definition of done:** Clean `.gitignore` on both apps, a successful production
build, and no `localhost` references in production runtime configuration. Any
remaining development/test-only `localhost` references must be intentional and
documented by the agent.

---

*Report back section by section — don't bundle findings from multiple sections into one
message. Once all six are confirmed done, we'll move to the actual platform deployment
steps (Vercel, Render, Atlas, Cloudinary account setup).*