# AI Resume Analyzer — Full Stack Implementation Plan

Converting RESUMEIT from Next.js + Puter.js (client-only) into a full stack app:
**Next.js (client) + Express.js + MongoDB + Axios + bcrypt + JWT + Multer + Gemini**

Work through phases in order. Each phase has a clear goal and a "definition of done" —
don't start the next phase until the current one is actually working end to end.

---

## Current status (as of this doc)

- [x] `client/` scaffolded with Next.js + Tailwind CSS + JavaScript, all dependencies installed
- [x] Folder structure recreated: `app/auth/login`, `app/auth/register`, `app/resume/[id]`,
      `app/resume-history`, `app/upload`, all `components/`, `constants/index.js`,
      `lib/axios.js`, `lib/pdf2img.js`, `lib/store.js`, `lib/utils.js`
- [ ] `lib/axios.js` and `lib/store.js` are placeholder files — not yet implemented
- [ ] Puter script (`layout.jsx`) and any remaining `puter` references — not yet removed
- [ ] `server/` — not created yet
- [ ] MongoDB, Gemini API key — not set up yet

---

## Phase 0 — Server Scaffolding

**Goal:** A bare Express server that runs, connects to MongoDB, and responds to a health check.

- Create `server/` at the project root, sibling to `client/`
- `npm init` + install: `express`, `mongoose`, `dotenv`, `cors`, `cookie-parser`, `nodemon` (dev)
- `server/.env` — `PORT`, `MONGODB_URI`, `CLIENT_URL`
- `server/config/db.js` — Mongoose connection function
- `server/server.js` — Express app, `cors({ origin: CLIENT_URL, credentials: true })`,
  `cookie-parser`, JSON body parsing, one `GET /api/health` route
- Add `uploads/` to `server/.gitignore`

**Definition of done:** `npm run dev` in `server/` starts the server, connects to MongoDB
(Atlas or local), and `GET /api/health` returns a 200 in the browser or Postman.

---

## Phase 1 — Auth Backend

**Goal:** Real signup/login with hashed passwords and JWT sessions — no frontend yet.

- Install `bcrypt`, `jsonwebtoken`
- `server/models/User.js` — `name`, `email` (unique), `passwordHash`, `createdAt`
- `server/controllers/authController.js` — `register`, `login`, `logout`, `me`
- `server/middleware/auth.js` — verifies the JWT cookie, sets `req.userId`, 401 on failure
- `server/routes/authRoutes.js` — mounts at `/api/auth`:
  `POST /register`, `POST /login`, `POST /logout`, `GET /me` (protected)

**Definition of done:** Using Postman/Thunder Client, you can register a user, log in and
receive the auth cookie, hit `/me` and get your user back, and confirm `/me` fails without
the cookie.

---

## Phase 2 — Auth Frontend Integration

**Goal:** Real login/register pages talking to the Phase 1 endpoints; Puter auth fully replaced.

- Implement `client/lib/axios.js` — shared instance, `baseURL` from env, `withCredentials: true`
- Implement `client/lib/store.js` — Zustand `authStore`: `user`, `isAuthenticated`, `loading`,
  actions `register()`, `login()`, `logout()`, `fetchMe()`
- Wire `app/auth/login/page.jsx` and `app/auth/register/page.jsx` to the store actions
  (keep the existing form UI/validation, just change what happens on submit)
- Add a simple auth guard (redirect to `/auth/login` if `isAuthenticated` is false) for
  `upload`, `resume/[id]`, and `resume-history`
- Update `Navbar.jsx` logout button to call the store's `logout()`
- This is where Puter's auth dependency actually gets cut — after this phase, nothing calls
  `puter.auth` anywhere. (The Puter `<script>` tag and `lib/puter.js` file stay for now —
  `upload`, `resume/[id]`, and `resume-history` still depend on `puter.fs` / `puter.kv` /
  `puter.ai` until Phases 4–7 replace them. Full removal is Phase 8.)

**Definition of done:** You can register, log in, get redirected properly, refresh the page
and stay logged in (via `/me`), and log out — all without Puter involved.

---

## Phase 3 — Resume Data Model + Plumbing (no AI yet)

**Goal:** Protected CRUD for resumes, backed by MongoDB, before AI is in the picture.

- `server/models/Resume.js` — `userId` (ref), `companyName`, `jobTitle`, `jobDescription`,
  `resumePath`, `imagePath`, `feedback` (object, empty for now), `createdAt`
- `server/controllers/resumeController.js` — `create` (metadata only, no file yet),
  `list`, `getById`, `deleteOne`, `deleteAll`
- `server/routes/resumeRoutes.js` — mounts at `/api/resumes` (all protected by `auth` middleware):
  `POST /`, `GET /`, `GET /:id`, `DELETE /:id`, `DELETE /`

**Definition of done:** Via Postman, a logged-in user can create a resume record, list their
own records only, fetch one by id, and delete it.

---

## Phase 4 — File Upload (Multer)

**Goal:** The PDF (and its generated thumbnail) actually gets stored, and its path saved.

- Install `multer`
- `server/middleware/upload.js` — disk storage into `server/uploads/`, `fileFilter` for
  PDF only, a sane `fileSize` limit
- Extend the `create`/`analyze` route to accept `multipart/form-data` with the PDF file
  plus the text fields, and save the resulting path onto the `Resume` doc
- Keep `client/lib/pdf2img.js` as-is for the thumbnail — just change where the PNG gets sent

**Definition of done:** Uploading a PDF through Postman (or a quick test form) results in
the file landing in `server/uploads/` and its path stored on the Mongo document.

---

## Phase 5 — AI Integration (Gemini)

**Goal:** The analyze endpoint returns real, structured feedback.

- Get a Gemini API key from Google AI Studio, add `GEMINI_API_KEY` to `server/.env`
- Install `@google/genai` (the current unified SDK — `@google/generative-ai` is deprecated)
- `server/services/aiService.js` — port the prompt logic from `client/constants/index.js`,
  call Gemini with JSON-mode/`responseSchema` so it returns an object matching the existing
  `Feedback` shape, validate the response
- Wire this into the `analyze` controller: upload → extract text (or pass the file directly,
  your call) → `aiService` → save `feedback` on the `Resume` doc → return it

**Definition of done:** Posting a real resume + job description through Postman returns a
full `Feedback` JSON object, and it's saved on the Mongo document.

---

## Phase 6 — Frontend: Upload & Analyze Flow

**Goal:** The actual "Analyze Resume" button works end to end from the UI.

- Add a `resumeStore` (or extend the existing store) with an `analyzeResume(formData)` action
  that posts to `/api/resumes/analyze` via Axios and stores loading/result state
- Wire `FileUploader.jsx` and the `upload/page.jsx` submit handler to this action
- On success, redirect to `/resume/[id]` using the id returned from the API

**Definition of done:** From the actual UI — fill the form, drop a PDF, click Analyze — you
land on a working resume detail page with real AI feedback rendered.

---

## Phase 7 — Resume Detail & History Pages

**Goal:** Everything that used to read from Puter KV now reads from MongoDB.

- `app/resume/[id]/page.jsx` — fetch via `GET /api/resumes/:id`
- `app/resume-history/page.jsx` — fetch via `GET /api/resumes`; keep existing client-side
  search/filter logic as-is, it just needs real data now
- Wire the "Wipe Data" button to `DELETE /api/resumes`

**Definition of done:** History page shows all your past analyses from Mongo, detail page
renders correctly, wipe actually clears the database (and ideally the uploaded files too).

---

## Phase 8 — Puter Cleanup (Final Audit)

**Goal:** Confirm nothing depends on Puter anymore and remove the last remnants. The actual
functional replacement already happened progressively — auth in Phase 2, file/KV/AI in
Phases 4–7 — so this phase is verification and file deletion, not a rewrite.

- Delete `client/lib/puter.js` (if not already replaced by `store.js`)
- Remove the Puter `<script>` tag from `app/layout.jsx`
- Remove `puter` from `client/package.json` if it's listed as a dependency
- Grep the whole `client/` folder for `puter` to catch anything missed

**Definition of done:** A full-text search for "puter" in `client/` returns nothing except
maybe this plan file.

---

## Phase 9 — Polish & Error Handling

**Goal:** The app behaves well outside the happy path.

- Loading states for auth, upload, and analyze actions (buttons disabled while pending, spinners)
- Error states surfaced to the user (invalid file type, network failure, Gemini failure)
- Basic input validation on the server (not just relying on the client form)
- Confirm auth cookie expiry behavior and what happens when a token expires mid-session

**Definition of done:** Deliberately trying to break things (empty fields, huge file, wrong
file type, expired session) fails gracefully instead of crashing.

---

## Phase 10 — Deployment (optional / stretch)

**Goal:** A live, shareable version.

- MongoDB Atlas (free tier) instead of local Mongo
- `server/` deployed to Render/Railway, with production env vars set there
- `client/` deployed to Vercel, `NEXT_PUBLIC_API_URL` pointed at the deployed server
- Update CORS `origin` on the server to the deployed client URL

**Definition of done:** The live Vercel URL works fully against the live server — signup,
upload, analyze, history — with no localhost references left.

---

*One phase at a time — say the phase number when you're ready to start, and we'll build it
piece by piece from there.*
