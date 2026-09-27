const { PDFParse } = require('pdf-parse');
const cloudinaryService = require('./cloudinaryService');

/**
 * Extracts plain text from an authenticated resume PDF stored in Cloudinary.
 *
 * @param {string} resumePublicId - Exact Cloudinary public_id stored in DB
 * @returns {Promise<string>} Trimmed extracted text
 */
const extractTextFromPdf = async (resumePublicId) => {
  if (!resumePublicId || typeof resumePublicId !== 'string') {
    const err = new Error('Invalid resume public ID');
    err.code = 'INVALID_PATH';
    throw err;
  }

  // Generate short-lived signed download URL
  const signedUrl = cloudinaryService.generateSignedUrl(resumePublicId);
  if (!signedUrl) {
    const err = new Error('Unable to generate access URL for resume');
    err.code = 'FILE_NOT_FOUND';
    throw err;
  }

  // Fetch file buffer from Cloudinary into memory
  let buffer;
  try {
    const response = await fetch(signedUrl);
    if (!response.ok) {
      const err = new Error('Stored resume file not found on server');
      err.code = 'FILE_NOT_FOUND';
      throw err;
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (fetchErr) {
    if (fetchErr.code === 'FILE_NOT_FOUND') {
      throw fetchErr;
    }
    const err = new Error('Unable to read resume file from storage');
    err.code = 'FILE_READ_ERROR';
    err.details = fetchErr.message;
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
  extractTextFromPdf,
};
