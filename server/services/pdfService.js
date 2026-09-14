const path = require('path');
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const UPLOAD_DIR = path.resolve(__dirname, '../uploads');

/**
 * Safely resolves the stored resume path within the server/uploads boundary,
 * guarding against directory traversal attacks.
 *
 * @param {string} storedResumePath - Path stored in DB (e.g. '/uploads/resume-xxx.pdf')
 * @returns {string} Safe absolute filesystem path
 */
const resolveSafePath = (storedResumePath) => {
  if (!storedResumePath || typeof storedResumePath !== 'string') {
    const err = new Error('Invalid resume file path');
    err.code = 'INVALID_PATH';
    throw err;
  }

  const filename = path.basename(storedResumePath);
  const resolvedPath = path.resolve(UPLOAD_DIR, filename);

  // Assert target path is strictly within UPLOAD_DIR
  if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep)) {
    const err = new Error('Access denied: Invalid file path traversal');
    err.code = 'PATH_TRAVERSAL';
    throw err;
  }

  return resolvedPath;
};

/**
 * Extracts plain text from a stored resume PDF file.
 *
 * @param {string} storedResumePath - Path stored in DB (e.g. '/uploads/resume-xxx.pdf')
 * @returns {Promise<string>} Trimmed extracted text
 */
const extractTextFromPdf = async (storedResumePath) => {
  const filePath = resolveSafePath(storedResumePath);

  // Verify file existence and read permissions
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
  } catch (accessErr) {
    const err = new Error('Stored resume file not found on server');
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  // Read file into buffer
  let buffer;
  try {
    buffer = await fs.promises.readFile(filePath);
  } catch (readErr) {
    const err = new Error('Unable to read resume file from disk');
    err.code = 'FILE_READ_ERROR';
    throw err;
  }

  // Parse PDF and extract text using pdf-parse v2 class API
  let parser;
  let text = '';
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = (result?.text || '').trim();
  } catch (parseErr) {
    const err = new Error('Failed to extract text from resume PDF');
    err.code = 'CORRUPTED_PDF';
    err.details = parseErr.message;
    throw err;
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }

  // Clean out pdf-parse pagination markers like "-- 1 of 1 --"
  const cleanedText = text
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .trim();

  if (!cleanedText) {
    const err = new Error('Resume PDF does not contain extractable text');
    err.code = 'EMPTY_TEXT';
    throw err;
  }

  return cleanedText;
};

module.exports = {
  resolveSafePath,
  extractTextFromPdf,
};
