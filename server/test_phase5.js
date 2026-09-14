const path = require('path');
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const authRoutes = require('./routes/authRoutes');
const resumeRoutes = require('./routes/resumeRoutes');
const pdfService = require('./services/pdfService');
const aiService = require('./services/aiService');
const User = require('./models/User');
const Resume = require('./models/Resume');

// Setup test app
const app = express();
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Server is healthy' });
});

app.use('/api/auth', authRoutes);
app.use('/api/resumes', resumeRoutes);

let server;
let baseUrl;
const TEST_PORT = 5599;

// Minimal valid single-page PDF generator
const createMinimalPdfBuffer = (text = 'Resume Sample Text') => {
  const streamContent = `BT\n/F1 18 Tf\n50 700 Td\n(${text}) Tj\nET`;
  const streamLen = Buffer.byteLength(streamContent);
  const pdfRaw =
    '%PDF-1.4\n' +
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n' +
    `4 0 obj << /Length ${streamLen} >> stream\n${streamContent}\nendstream\nendobj\n` +
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n' +
    'xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000261 00000 n \n0000000370 00000 n \n' +
    'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n450\n%%EOF';
  return Buffer.from(pdfRaw, 'binary');
};

// Minimal PDF with NO text
const createEmptyPdfBuffer = () => {
  const streamContent = '';
  const pdfRaw =
    '%PDF-1.4\n' +
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n' +
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n' +
    `4 0 obj << /Length 0 >> stream\n\nendstream\nendobj\n` +
    'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000215 00000 n \n' +
    'trailer << /Size 5 /Root 1 0 R >>\nstartxref\n260\n%%EOF';
  return Buffer.from(pdfRaw, 'binary');
};

// HTTP Request helper
const request = async ({ method, url, headers = {}, body = null, cookie = null }) => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url, baseUrl);
    const reqHeaders = { ...headers };

    if (cookie) {
      reqHeaders['Cookie'] = cookie;
    }

    let payload = null;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    } else if (Buffer.isBuffer(body)) {
      payload = body;
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(rawBody);
        } catch (_) {}

        // Extract cookies if any
        const setCookies = res.headers['set-cookie'] || [];
        const cookies = setCookies.map((c) => c.split(';')[0]).join('; ');

        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json !== null ? json : rawBody,
          cookie: cookies,
        });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
};

// Multipart form upload helper
const uploadMultipart = async ({ url, cookie, fields = {}, file = null }) => {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(16).substring(2);
  const crlf = '\r\n';
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="${key}"${crlf}${crlf}${value}${crlf}`
    ));
  }

  if (file) {
    parts.push(Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"${crlf}Content-Type: ${file.contentType}${crlf}${crlf}`
    ));
    parts.push(file.buffer);
    parts.push(Buffer.from(crlf));
  }

  parts.push(Buffer.from(`--${boundary}--${crlf}`));
  const body = Buffer.concat(parts);

  return request({
    method: 'POST',
    url,
    cookie,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    body,
  });
};

let passedAssertions = 0;
let failedAssertions = 0;
const failures = [];

const assert = (condition, description) => {
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${description}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${description}`);
    failures.push(description);
  }
};

const runTestSuite = async () => {
  console.log('====================================================');
  console.log('STARTING PHASE 5 TEST SUITE & REGRESSION VERIFICATION');
  console.log('====================================================\n');

  // Connect to DB
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected for testing.\n');

  // Start HTTP server
  server = app.listen(TEST_PORT);
  baseUrl = `http://localhost:${TEST_PORT}`;
  console.log(`Test server running on ${baseUrl}\n`);

  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Cleanup test users from previous runs
  await User.deleteMany({ email: { $in: ['user_a_p5@test.com', 'user_b_p5@test.com', 'reg_p1@test.com'] } });

  try {
    // ----------------------------------------------------
    // Section 1: UNIT & SERVICE LEVEL TESTS (PDF & AI)
    // ----------------------------------------------------
    console.log('--- SECTION 1: Service Layer Unit Tests ---');

    // 1.1 PDF Safe Path Traversal Detection
    // path.basename() in resolveSafePath neutralizes directory traversal by stripping
    // all path components, so '../../etc/passwd' becomes 'passwd' → resolves to uploads/passwd.
    // The defense is neutralization (basename stripping) rather than error throwing.
    let traversalNeutralized = false;
    try {
      const UPLOAD_DIR = path.resolve(__dirname, 'uploads');
      const resolved = pdfService.resolveSafePath('../../etc/passwd');
      // Resolved path must be inside UPLOAD_DIR; traversal is silently neutralized
      traversalNeutralized = resolved.startsWith(UPLOAD_DIR);
    } catch (e) {
      // If the implementation throws PATH_TRAVERSAL, that also counts as safe
      traversalNeutralized = e.code === 'PATH_TRAVERSAL';
    }
    assert(traversalNeutralized, 'pdfService.resolveSafePath neutralizes directory traversal attempts (basename stripping)');

    // 1.2 PDF Invalid Path Rejection
    let invalidPathCaught = false;
    try {
      pdfService.resolveSafePath('');
    } catch (e) {
      invalidPathCaught = e.code === 'INVALID_PATH';
    }
    assert(invalidPathCaught, 'pdfService.resolveSafePath rejects empty/invalid path');

    // 1.3 Missing Physical File Error
    let fileNotFoundCaught = false;
    try {
      await pdfService.extractTextFromPdf('/uploads/non-existent-12345.pdf');
    } catch (e) {
      fileNotFoundCaught = e.code === 'FILE_NOT_FOUND';
    }
    assert(fileNotFoundCaught, 'pdfService.extractTextFromPdf throws FILE_NOT_FOUND for nonexistent file');

    // 1.4 Corrupted PDF File Error
    const corruptFilename = `test-corrupt-${Date.now()}.pdf`;
    const corruptPath = path.join(uploadsDir, corruptFilename);
    await fs.promises.writeFile(corruptPath, 'This is definitely not a PDF file');
    let corruptCaught = false;
    try {
      await pdfService.extractTextFromPdf(`/uploads/${corruptFilename}`);
    } catch (e) {
      corruptCaught = e.code === 'CORRUPTED_PDF';
    } finally {
      await fs.promises.unlink(corruptPath).catch(() => {});
    }
    assert(corruptCaught, 'pdfService.extractTextFromPdf throws CORRUPTED_PDF on invalid PDF bytes');

    // 1.5 Empty Text PDF Error
    const emptyFilename = `test-empty-${Date.now()}.pdf`;
    const emptyPath = path.join(uploadsDir, emptyFilename);
    await fs.promises.writeFile(emptyPath, createEmptyPdfBuffer());
    let emptyCaught = false;
    try {
      await pdfService.extractTextFromPdf(`/uploads/${emptyFilename}`);
    } catch (e) {
      emptyCaught = e.code === 'EMPTY_TEXT';
    } finally {
      await fs.promises.unlink(emptyPath).catch(() => {});
    }
    assert(emptyCaught, 'pdfService.extractTextFromPdf throws EMPTY_TEXT on PDF with no text stream');

    // 1.6 Valid PDF Text Extraction
    const validFilename = `test-valid-${Date.now()}.pdf`;
    const validPath = path.join(uploadsDir, validFilename);
    const resumeTextContent = 'Alice Developer, React and Node.js Architect with 7 years experience';
    await fs.promises.writeFile(validPath, createMinimalPdfBuffer(resumeTextContent));
    let extractedText = '';
    try {
      extractedText = await pdfService.extractTextFromPdf(`/uploads/${validFilename}`);
    } finally {
      await fs.promises.unlink(validPath).catch(() => {});
    }
    assert(extractedText.includes('Alice Developer'), 'pdfService.extractTextFromPdf extracts readable text from PDF');

    // 1.7 AI Service Prompt Builder
    const prompt = aiService.buildPrompt({
      resumeText: 'Test Resume',
      companyName: 'Acme Corp',
      jobTitle: 'Senior Engineer',
      jobDescription: 'Build scalable APIs',
    });
    assert(prompt.includes('Acme Corp') && prompt.includes('Senior Engineer') && prompt.includes('Build scalable APIs') && prompt.includes('Test Resume'),
      'aiService.buildPrompt incorporates companyName, jobTitle, jobDescription, and resumeText');

    // 1.8 AI Service Feedback Validator - Valid Input
    const sampleValidFeedback = {
      overallScore: 82,
      ATS: {
        score: 85,
        tips: [
          { type: 'good', tip: 'Clear standard section titles' },
          { type: 'improve', tip: 'Add more keywords for React' }
        ]
      },
      toneAndStyle: {
        score: 80,
        tips: [{ type: 'good', tip: 'Action verbs', explanation: 'Strong action verbs used throughout' }]
      },
      content: {
        score: 85,
        tips: [{ type: 'good', tip: 'Metrics included', explanation: 'Quantified results provided' }]
      },
      structure: {
        score: 75,
        tips: [{ type: 'improve', tip: 'Page count', explanation: 'Keep it within two pages' }]
      },
      skills: {
        score: 88,
        tips: [{ type: 'good', tip: 'Strong tech stack', explanation: 'Matches required frontend tools' }]
      }
    };
    const validated = aiService.validateFeedback(sampleValidFeedback);
    assert(validated.overallScore === 82 && validated.ATS.score === 85, 'aiService.validateFeedback validates and sanitizes valid feedback structure');

    // 1.9 AI Service Feedback Validator - Invalid Score Bounds
    let invalidScoreCaught = false;
    try {
      aiService.validateFeedback({ ...sampleValidFeedback, overallScore: 105 });
    } catch (e) {
      invalidScoreCaught = true;
    }
    assert(invalidScoreCaught, 'aiService.validateFeedback rejects overallScore > 100');

    // 1.10 AI Service Feedback Validator - Missing Category
    let missingCategoryCaught = false;
    try {
      const { skills, ...withoutSkills } = sampleValidFeedback;
      aiService.validateFeedback(withoutSkills);
    } catch (e) {
      missingCategoryCaught = true;
    }
    assert(missingCategoryCaught, 'aiService.validateFeedback rejects response missing a required category');

    // 1.11 AI Service Feedback Validator - Invalid Tip Type
    let invalidTipTypeCaught = false;
    try {
      aiService.validateFeedback({
        ...sampleValidFeedback,
        ATS: {
          score: 80,
          tips: [{ type: 'neutral', tip: 'Invalid type' }]
        }
      });
    } catch (e) {
      invalidTipTypeCaught = true;
    }
    assert(invalidTipTypeCaught, 'aiService.validateFeedback rejects tip with type other than good/improve');

    console.log('\n--- SECTION 2: Auth Setup & Cross-User Security ---');

    // Register User A
    const resA = await request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: 'User A', email: 'user_a_p5@test.com', password: 'Password123!' },
    });
    const cookieA = resA.cookie;
    const userA = resA.body.user;
    assert(resA.status === 201 && cookieA.includes('token='), 'User A registered and received auth cookie');

    // Register User B
    const resB = await request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: 'User B', email: 'user_b_p5@test.com', password: 'Password123!' },
    });
    const cookieB = resB.cookie;
    const userB = resB.body.user;
    assert(resB.status === 201 && cookieB.includes('token='), 'User B registered and received auth cookie');

    // User A creates a resume with uploaded PDF
    const userAPdfBuffer = createMinimalPdfBuffer('Jane Doe, Full Stack Engineer with 5 years in Node.js and MongoDB');
    const uploadResA = await uploadMultipart({
      url: '/api/resumes',
      cookie: cookieA,
      fields: {
        companyName: 'Stripe',
        jobTitle: 'Backend Engineer',
        jobDescription: 'Build resilient payment APIs with Node.js and distributed databases',
      },
      file: {
        fieldname: 'resume',
        filename: 'jane_doe_resume.pdf',
        contentType: 'application/pdf',
        buffer: userAPdfBuffer,
      },
    });
    assert(uploadResA.status === 201, 'User A uploaded a valid resume with PDF');
    const resumeA = uploadResA.body.resume;

    // User B creates a resume with uploaded PDF
    const userBPdfBuffer = createMinimalPdfBuffer('Bob Smith, DevOps Engineer with Kubernetes and Cloud infrastructure');
    const uploadResB = await uploadMultipart({
      url: '/api/resumes',
      cookie: cookieB,
      fields: {
        companyName: 'Netflix',
        jobTitle: 'Cloud Architect',
        jobDescription: 'Manage AWS cloud and CI/CD pipelines',
      },
      file: {
        fieldname: 'resume',
        filename: 'bob_smith_resume.pdf',
        contentType: 'application/pdf',
        buffer: userBPdfBuffer,
      },
    });
    assert(uploadResB.status === 201, 'User B uploaded a valid resume with PDF');
    const resumeB = uploadResB.body.resume;

    // 2.1 Unauthenticated Analyze Request
    const unauthRes = await request({
      method: 'POST',
      url: `/api/resumes/${resumeA._id}/analyze`,
    });
    assert(unauthRes.status === 401, 'POST /api/resumes/:id/analyze without cookie returns 401');

    // 2.2 Cross-User Security: User B cannot analyze User A's resume
    const bAnalyzesARes = await request({
      method: 'POST',
      url: `/api/resumes/${resumeA._id}/analyze`,
      cookie: cookieB,
    });
    assert(bAnalyzesARes.status === 404, 'User B cannot analyze User A resume -> returns 404');

    // 2.3 Cross-User Security: User A cannot analyze User B's resume
    const aAnalyzesBRes = await request({
      method: 'POST',
      url: `/api/resumes/${resumeB._id}/analyze`,
      cookie: cookieA,
    });
    assert(aAnalyzesBRes.status === 404, 'User A cannot analyze User B resume -> returns 404');

    // 2.4 Invalid Resume ID Format
    const invalidIdRes = await request({
      method: 'POST',
      url: '/api/resumes/not-a-valid-id/analyze',
      cookie: cookieA,
    });
    assert(invalidIdRes.status === 400 && invalidIdRes.body.message.includes('Invalid resume ID format'),
      'Invalid ObjectId format returns 400');

    // 2.5 Nonexistent Resume ID
    const fakeId = new mongoose.Types.ObjectId().toString();
    const fakeIdRes = await request({
      method: 'POST',
      url: `/api/resumes/${fakeId}/analyze`,
      cookie: cookieA,
    });
    assert(fakeIdRes.status === 404 && fakeIdRes.body.message === 'Resume not found',
      'Nonexistent resume ID returns 404');

    // 2.6 Metadata-Only Resume (no resumePath)
    const metaResume = await Resume.create({
      userId: userA.id,
      companyName: 'MetaCorp',
      jobTitle: 'Analyst',
      resumePath: '',
    });
    const noFileRes = await request({
      method: 'POST',
      url: `/api/resumes/${metaResume._id}/analyze`,
      cookie: cookieA,
    });
    assert(noFileRes.status === 400 && noFileRes.body.message.includes('does not have an uploaded file'),
      'Resume with no resumePath returns 400 Bad Request');
    await Resume.findByIdAndDelete(metaResume._id);

    // 2.7 Missing Physical File on Disk
    const missingFileResume = await Resume.create({
      userId: userA.id,
      companyName: 'GhostCorp',
      jobTitle: 'Ghost Engineer',
      resumePath: '/uploads/ghost-file-does-not-exist.pdf',
    });
    const missingPhysicalRes = await request({
      method: 'POST',
      url: `/api/resumes/${missingFileResume._id}/analyze`,
      cookie: cookieA,
    });
    assert(missingPhysicalRes.status === 404 && missingPhysicalRes.body.message.includes('Stored resume file not found'),
      'Missing physical PDF file on disk returns 404');
    await Resume.findByIdAndDelete(missingFileResume._id);

    // 2.8 Empty Extracted Text PDF
    const emptyPdfFilename = `test-empty-user-${Date.now()}.pdf`;
    const emptyPdfDiskPath = path.join(uploadsDir, emptyPdfFilename);
    await fs.promises.writeFile(emptyPdfDiskPath, createEmptyPdfBuffer());
    const emptyResume = await Resume.create({
      userId: userA.id,
      companyName: 'EmptyCorp',
      jobTitle: 'Empty Role',
      resumePath: `/uploads/${emptyPdfFilename}`,
    });
    const emptyTextRes = await request({
      method: 'POST',
      url: `/api/resumes/${emptyResume._id}/analyze`,
      cookie: cookieA,
    });
    assert(emptyTextRes.status === 422 && emptyTextRes.body.message.includes('does not contain extractable text'),
      'PDF with empty extractable text returns 422 Unprocessable Entity');
    await Resume.findByIdAndDelete(emptyResume._id);
    await fs.promises.unlink(emptyPdfDiskPath).catch(() => {});

    console.log('\n--- SECTION 3: Live End-to-End Gemini Analysis & Persistence ---');

    // 3.1 Live Analyze Endpoint Execution
    console.log('  Calling POST /api/resumes/:id/analyze with live Gemini...');
    const analyzeRes = await request({
      method: 'POST',
      url: `/api/resumes/${resumeA._id}/analyze`,
      cookie: cookieA,
    });

    assert(analyzeRes.status === 200, 'POST /api/resumes/:id/analyze returns HTTP 200 on success');
    const feedback = analyzeRes.body.feedback;
    assert(Boolean(feedback), 'Response contains feedback object');
    assert(typeof feedback.overallScore === 'number' && feedback.overallScore >= 0 && feedback.overallScore <= 100,
      'Feedback overallScore is a valid number between 0 and 100');

    // 3.2 ATS schema verification
    assert(typeof feedback.ATS.score === 'number' && feedback.ATS.score >= 0 && feedback.ATS.score <= 100,
      'Feedback ATS.score is between 0 and 100');
    assert(Array.isArray(feedback.ATS.tips) && feedback.ATS.tips.length > 0,
      'Feedback ATS.tips is a non-empty array');
    const allAtsTipsValid = feedback.ATS.tips.every(
      (t) => ['good', 'improve'].includes(t.type) && typeof t.tip === 'string' && t.tip.length > 0
    );
    assert(allAtsTipsValid, 'All ATS tips have valid type (good/improve) and string tip');

    // 3.3 Category objects verification
    const categories = ['toneAndStyle', 'content', 'structure', 'skills'];
    for (const cat of categories) {
      const catObj = feedback[cat];
      const isValidCat =
        typeof catObj?.score === 'number' &&
        catObj.score >= 0 &&
        catObj.score <= 100 &&
        Array.isArray(catObj.tips) &&
        catObj.tips.length > 0 &&
        catObj.tips.every(
          (t) =>
            ['good', 'improve'].includes(t.type) &&
            typeof t.tip === 'string' &&
            t.tip.length > 0 &&
            typeof t.explanation === 'string' &&
            t.explanation.length > 0
        );
      assert(isValidCat, `Category ${cat} has score [0-100] and tips with type, tip, and explanation`);
    }

    // 3.4 MongoDB Persistence Verification
    const updatedDoc = await Resume.findById(resumeA._id);
    assert(Boolean(updatedDoc.feedback && updatedDoc.feedback.overallScore === feedback.overallScore),
      'Validated feedback is persisted directly to MongoDB Resume document');

    // 3.5 Verification via GET /api/resumes/:id
    const getRes = await request({
      method: 'GET',
      url: `/api/resumes/${resumeA._id}`,
      cookie: cookieA,
    });
    assert(getRes.status === 200 && getRes.body.resume.feedback.overallScore === feedback.overallScore,
      'Subsequent GET /api/resumes/:id contains persisted feedback');

    // 3.6 Server remains healthy after successful analysis
    const healthRes1 = await request({ method: 'GET', url: '/api/health' });
    assert(healthRes1.status === 200 && healthRes1.body.status === 'ok', 'Server health check returns 200 OK');

    console.log('\n--- SECTION 4: Regression Tests (Phases 1, 3, 4) ---');

    // 4.1 Phase 1 Auth: Register, Login, Me, Logout
    const regUserRes = await request({
      method: 'POST',
      url: '/api/auth/register',
      body: { name: 'Regression User', email: 'reg_p1@test.com', password: 'Password123!' },
    });
    assert(regUserRes.status === 201, 'Regression: Phase 1 Register returns 201');
    const regCookie = regUserRes.cookie;

    const meRes = await request({
      method: 'GET',
      url: '/api/auth/me',
      cookie: regCookie,
    });
    assert(meRes.status === 200 && meRes.body.user.email === 'reg_p1@test.com', 'Regression: Phase 1 /me returns 200');

    const logoutRes = await request({
      method: 'POST',
      url: '/api/auth/logout',
      cookie: regCookie,
    });
    assert(logoutRes.status === 200, 'Regression: Phase 1 Logout returns 200');

    const loginRes = await request({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'reg_p1@test.com', password: 'Password123!' },
    });
    assert(loginRes.status === 200 && loginRes.cookie.includes('token='), 'Regression: Phase 1 Login returns 200');

    // 4.2 Phase 3 Resume CRUD (metadata-only)
    const createMetaRes = await request({
      method: 'POST',
      url: '/api/resumes',
      cookie: regCookie,
      body: { companyName: 'RegCorp', jobTitle: 'Test Lead', jobDescription: 'Lead testing' },
    });
    assert(createMetaRes.status === 201, 'Regression: Phase 3 Create metadata-only resume returns 201');
    const metaId = createMetaRes.body.resume._id;

    const listRes = await request({
      method: 'GET',
      url: '/api/resumes',
      cookie: regCookie,
    });
    assert(listRes.status === 200 && listRes.body.resumes.length >= 1, 'Regression: Phase 3 List resumes returns 200');

    const getSingleRes = await request({
      method: 'GET',
      url: `/api/resumes/${metaId}`,
      cookie: regCookie,
    });
    assert(getSingleRes.status === 200 && getSingleRes.body.resume.companyName === 'RegCorp', 'Regression: Phase 3 Get resume by ID returns 200');

    const deleteSingleRes = await request({
      method: 'DELETE',
      url: `/api/resumes/${metaId}`,
      cookie: regCookie,
    });
    assert(deleteSingleRes.status === 200, 'Regression: Phase 3 Delete resume returns 200');

    // 4.3 Phase 4 File Upload & Restrictions
    // Magic byte rejection for non-PDF disguised as PDF
    const fakePdfRes = await uploadMultipart({
      url: '/api/resumes',
      cookie: regCookie,
      fields: { companyName: 'FakeCorp', jobTitle: 'Hacker' },
      file: {
        fieldname: 'resume',
        filename: 'fake.pdf',
        contentType: 'application/pdf',
        buffer: Buffer.from('NOT A PDF FILE SIGNATURE'),
      },
    });
    assert(fakePdfRes.status === 400 && fakePdfRes.body.message.includes('Invalid PDF file signature'),
      'Regression: Phase 4 Magic-byte check rejects non-PDF content');

    // Non-PDF extension rejection
    const txtFileRes = await uploadMultipart({
      url: '/api/resumes',
      cookie: regCookie,
      fields: { companyName: 'TxtCorp', jobTitle: 'Writer' },
      file: {
        fieldname: 'resume',
        filename: 'notes.txt',
        contentType: 'text/plain',
        buffer: Buffer.from('Hello world'),
      },
    });
    assert(txtFileRes.status === 400 && txtFileRes.body.message.includes('Only PDF files are allowed'),
      'Regression: Phase 4 Multer filter rejects non-PDF file type');

    // File unlinking on resume delete
    const deleteTestPdfBuffer = createMinimalPdfBuffer('Delete test resume content');
    const uploadForDeleteRes = await uploadMultipart({
      url: '/api/resumes',
      cookie: regCookie,
      fields: { companyName: 'DeleteCorp', jobTitle: 'Temp Role' },
      file: {
        fieldname: 'resume',
        filename: 'to_delete.pdf',
        contentType: 'application/pdf',
        buffer: deleteTestPdfBuffer,
      },
    });
    const deleteResumeDoc = uploadForDeleteRes.body.resume;
    const deleteFilename = path.basename(deleteResumeDoc.resumePath);
    const deleteDiskPath = path.join(uploadsDir, deleteFilename);
    assert(fs.existsSync(deleteDiskPath), 'Regression: Phase 4 Stored PDF file exists on disk');

    await request({
      method: 'DELETE',
      url: `/api/resumes/${deleteResumeDoc._id}`,
      cookie: regCookie,
    });
    assert(!fs.existsSync(deleteDiskPath), 'Regression: Phase 4 Delete resume automatically unlinks stored PDF from disk');

    // 4.4 Final Server Health Check
    const finalHealthRes = await request({ method: 'GET', url: '/api/health' });
    assert(finalHealthRes.status === 200 && finalHealthRes.body.status === 'ok',
      'Server remains healthy and running after all Phase 5 and regression tests');

  } finally {
    // Teardown
    console.log('\nCleaning up test users and resumes...');
    await User.deleteMany({ email: { $in: ['user_a_p5@test.com', 'user_b_p5@test.com', 'reg_p1@test.com'] } });
    await Resume.deleteMany({ companyName: { $in: ['Stripe', 'Netflix', 'MetaCorp', 'GhostCorp', 'EmptyCorp', 'RegCorp', 'DeleteCorp'] } });

    if (server) {
      server.close();
    }
    await mongoose.connection.close();
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY:`);
  console.log(`  PASSED: ${passedAssertions}`);
  console.log(`  FAILED: ${failedAssertions}`);
  console.log('====================================================');

  if (failures.length > 0) {
    console.log('\nFailures list:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  } else {
    console.log('\nALL ASSERTIONS PASSED PERFECTLY (0 FAILURES)');
    process.exit(0);
  }
};

runTestSuite().catch((err) => {
  console.error('Fatal error during test suite execution:', err);
  process.exit(1);
});
