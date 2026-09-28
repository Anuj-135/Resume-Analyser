const { GoogleGenAI } = require('@google/genai');

const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error('Gemini API key is not configured on the server');
    error.code = 'CONFIG_ERROR';
    throw error;
  }
  return new GoogleGenAI({ apiKey });
};

// Detailed tip schema for categories with explanation
const detailedTipSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['good', 'improve'] },
    tip: { type: 'string', description: 'Concise title or heading for the suggestion' },
    explanation: { type: 'string', description: 'Detailed explanation and actionable improvement' },
  },
  required: ['type', 'tip', 'explanation'],
};

// Complete Feedback schema matching the frontend interface
const feedbackJsonSchema = {
  type: 'object',
  properties: {
    overallScore: { type: 'integer', description: 'Overall resume rating between 0 and 100' },
    ATS: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'ATS compatibility score between 0 and 100' },
        tips: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['good', 'improve'] },
              tip: { type: 'string', description: 'Actionable ATS suggestion' },
            },
            required: ['type', 'tip'],
          },
        },
      },
      required: ['score', 'tips'],
    },
    toneAndStyle: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'Tone and style score between 0 and 100' },
        tips: { type: 'array', items: detailedTipSchema },
      },
      required: ['score', 'tips'],
    },
    content: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'Content and experience score between 0 and 100' },
        tips: { type: 'array', items: detailedTipSchema },
      },
      required: ['score', 'tips'],
    },
    structure: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'Formatting and structure score between 0 and 100' },
        tips: { type: 'array', items: detailedTipSchema },
      },
      required: ['score', 'tips'],
    },
    skills: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'Skills relevance score between 0 and 100' },
        tips: { type: 'array', items: detailedTipSchema },
      },
      required: ['score', 'tips'],
    },
  },
  required: ['overallScore', 'ATS', 'toneAndStyle', 'content', 'structure', 'skills'],
};

/**
 * Builds the analysis prompt based on existing evaluation logic.
 */
const buildPrompt = ({ resumeText, companyName, jobTitle, jobDescription }) => {
  return `You are an expert in ATS (Applicant Tracking System) and professional resume analysis.
Please analyze and rate this resume and suggest how to improve it.
The rating can be low if the resume is bad.
Be thorough and detailed. Don't be afraid to point out any mistakes or areas for improvement.
If there is a lot to improve, don't hesitate to give low scores. This is to help the user to improve their resume.
If available, use the company name and job description for the job the user is applying to to give more detailed feedback.

TARGET APPLICATION CONTEXT:
- Target Company: ${companyName ? companyName.trim() : 'Not specified'}
- Target Job Title: ${jobTitle ? jobTitle.trim() : 'Not specified'}
- Job Description: ${jobDescription ? jobDescription.trim() : 'Not specified'}

CRITERIA:
1. ATS: Rate ATS suitability (readability, standard headings, keyword alignment). Provide 2-4 tips.
2. Tone & Style: Rate tone, active language, professionalism. Provide 2-4 tips with tip and explanation.
3. Content: Rate relevance, accomplishments, quantified metrics. Provide 2-4 tips with tip and explanation.
4. Structure: Rate layout, flow, section organization. Provide 2-4 tips with tip and explanation.
5. Skills: Rate hard and soft skills alignment with target role. Provide 2-4 tips with tip and explanation.

All scores must be integers between 0 and 100.
Tip type must be strictly "good" or "improve".

RESUME TEXT CONTENT:
${resumeText}`;
};

/**
 * Validates the parsed AI feedback against strict structural requirements.
 *
 * @param {any} data - Parsed JSON feedback object
 * @returns {object} Validated feedback object
 */
const validateFeedback = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('AI response is not a valid JSON object');
  }

  const isValidScore = (score) => typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100;

  if (!isValidScore(data.overallScore)) {
    throw new Error('Invalid overallScore: must be a number between 0 and 100');
  }

  // Validate ATS
  if (!data.ATS || typeof data.ATS !== 'object' || !isValidScore(data.ATS.score) || !Array.isArray(data.ATS.tips)) {
    throw new Error('Invalid ATS feedback structure or score');
  }
  for (const tip of data.ATS.tips) {
    if (!tip || typeof tip !== 'object' || !['good', 'improve'].includes(tip.type) || typeof tip.tip !== 'string' || !tip.tip.trim()) {
      throw new Error('Invalid ATS tip structure');
    }
  }

  // Validate categories with detailed explanations
  const categories = ['toneAndStyle', 'content', 'structure', 'skills'];
  for (const cat of categories) {
    const obj = data[cat];
    if (!obj || typeof obj !== 'object' || !isValidScore(obj.score) || !Array.isArray(obj.tips)) {
      throw new Error(`Invalid ${cat} feedback structure or score`);
    }
    for (const tip of obj.tips) {
      if (
        !tip ||
        typeof tip !== 'object' ||
        !['good', 'improve'].includes(tip.type) ||
        typeof tip.tip !== 'string' ||
        !tip.tip.trim() ||
        typeof tip.explanation !== 'string' ||
        !tip.explanation.trim()
      ) {
        throw new Error(`Invalid tip in ${cat}: required non-empty tip and explanation`);
      }
    }
  }

  return {
    overallScore: Math.round(data.overallScore),
    ATS: {
      score: Math.round(data.ATS.score),
      tips: data.ATS.tips.map((t) => ({
        type: t.type,
        tip: t.tip.trim(),
      })),
    },
    toneAndStyle: {
      score: Math.round(data.toneAndStyle.score),
      tips: data.toneAndStyle.tips.map((t) => ({
        type: t.type,
        tip: t.tip.trim(),
        explanation: t.explanation.trim(),
      })),
    },
    content: {
      score: Math.round(data.content.score),
      tips: data.content.tips.map((t) => ({
        type: t.type,
        tip: t.tip.trim(),
        explanation: t.explanation.trim(),
      })),
    },
    structure: {
      score: Math.round(data.structure.score),
      tips: data.structure.tips.map((t) => ({
        type: t.type,
        tip: t.tip.trim(),
        explanation: t.explanation.trim(),
      })),
    },
    skills: {
      score: Math.round(data.skills.score),
      tips: data.skills.tips.map((t) => ({
        type: t.type,
        tip: t.tip.trim(),
        explanation: t.explanation.trim(),
      })),
    },
  };
};

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404]);

const STATUS_STRING_MAP = {
  UNAVAILABLE: 503,
  RESOURCE_EXHAUSTED: 429,
  INTERNAL: 500,
  DEADLINE_EXCEEDED: 504,
  INVALID_ARGUMENT: 400,
  PERMISSION_DENIED: 403,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
};

const MAX_RETRY_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const RETRY_BACKOFF_FACTOR = 2;
const MAX_RETRY_DELAY_MS = 5000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Extracts numeric HTTP status code from error object or parsed JSON message.
 */
const extractStatusCode = (error) => {
  if (!error) return null;
  if (typeof error.status === 'number' && Number.isFinite(error.status)) {
    return error.status;
  }
  if (typeof error.status === 'string' && /^\d+$/.test(error.status)) {
    return parseInt(error.status, 10);
  }
  if (typeof error.code === 'number' && Number.isFinite(error.code)) {
    return error.code;
  }
  if (typeof error.code === 'string' && /^\d+$/.test(error.code)) {
    return parseInt(error.code, 10);
  }
  if (typeof error.message === 'string') {
    try {
      const parsed = JSON.parse(error.message);
      if (typeof parsed?.error?.code === 'number') {
        return parsed.error.code;
      }
      if (parsed?.error?.status && STATUS_STRING_MAP[parsed.error.status]) {
        return STATUS_STRING_MAP[parsed.error.status];
      }
    } catch {
      // not JSON
    }
  }
  return null;
};

/**
 * Determines whether an error is transient and retryable.
 */
const isRetryableError = (error) => {
  if (!error) return false;
  const status = extractStatusCode(error);

  if (status !== null) {
    if (NON_RETRYABLE_STATUS_CODES.has(status)) {
      return false;
    }
    if (RETRYABLE_STATUS_CODES.has(status)) {
      return true;
    }
    if (status >= 500 && status < 600) {
      return true;
    }
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Network / connection errors
  const message = error.message || '';
  const code = error.code || error.cause?.code || '';
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    message.includes('ECONNRESET') ||
    message.includes('ETIMEDOUT') ||
    (error.name === 'TypeError' && message.includes('fetch failed'))
  ) {
    return true;
  }

  return false;
};

/**
 * Calculates exponential backoff delay with small randomized jitter.
 */
const computeRetryDelay = (attempt) => {
  const baseDelay = Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
    MAX_RETRY_DELAY_MS
  );
  // Add small randomized jitter (0 to 250ms)
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);
};

/**
 * Wraps an async operation with exponential backoff retry and sanitized logging.
 */
const executeWithRetry = async (fn, options = {}) => {
  const maxAttempts = options.maxAttempts || MAX_RETRY_ATTEMPTS;
  const sleepFn = options.sleep || defaultSleep;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`[AI Service] Gemini API call succeeded on attempt ${attempt} of ${maxAttempts}.`);
      }
      return result;
    } catch (err) {
      lastError = err;
      const status = extractStatusCode(err);
      const retryable = isRetryableError(err);

      if (!retryable) {
        const statusLabel = status !== null ? status : 'unknown';
        console.error(`[AI Service] Gemini API call failed with non-retryable status ${statusLabel}. Aborting retries.`);
        throw err;
      }

      if (attempt >= maxAttempts) {
        const statusLabel = status !== null ? status : 'unknown';
        console.error(`[AI Service] Gemini API call failed after ${maxAttempts} attempts. Last status: ${statusLabel}.`);
        throw err;
      }

      const delayMs = computeRetryDelay(attempt);
      const statusLabel = status !== null ? status : (err.message || 'transient error');
      console.warn(`[AI Service] Gemini API call attempt ${attempt} failed with status ${statusLabel}. Retrying in ${delayMs}ms...`);
      await sleepFn(delayMs);
    }
  }
  throw lastError;
};

/**
 * Analyzes resume text against job details using Gemini AI with transient error retry.
 *
 * @param {object} params
 * @param {string} params.resumeText
 * @param {string} params.companyName
 * @param {string} params.jobTitle
 * @param {string} params.jobDescription
 * @param {object} [options]
 * @param {object} [options.client] - Optional Gemini client override for testing
 * @param {Function} [options.sleep] - Optional sleep function override for testing
 * @param {number} [options.maxAttempts] - Optional max attempts override for testing
 * @returns {Promise<object>} Validated feedback object
 */
const analyzeResume = async ({ resumeText, companyName, jobTitle, jobDescription }, options = {}) => {
  const ai = options.client || getGeminiClient();
  const prompt = buildPrompt({ resumeText, companyName, jobTitle, jobDescription });
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

  let response;
  try {
    response = await executeWithRetry(
      () =>
        ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: feedbackJsonSchema,
          },
        }),
      options
    );
  } catch (apiError) {
    const error = new Error('AI service failed to generate feedback');
    error.code = 'AI_API_ERROR';
    error.statusCode = 502;
    error.originalMessage = apiError.message;
    throw error;
  }

  const rawText = response?.text;
  if (!rawText) {
    const error = new Error('Empty response received from AI service');
    error.code = 'AI_EMPTY_RESPONSE';
    error.statusCode = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (parseError) {
    const error = new Error('Failed to parse AI response as JSON');
    error.code = 'AI_MALFORMED_JSON';
    error.statusCode = 502;
    throw error;
  }

  try {
    const validated = validateFeedback(parsed);
    return validated;
  } catch (validationError) {
    const error = new Error(`AI feedback failed schema validation: ${validationError.message}`);
    error.code = 'AI_VALIDATION_ERROR';
    error.statusCode = 502;
    throw error;
  }
};

module.exports = {
  buildPrompt,
  feedbackJsonSchema,
  validateFeedback,
  analyzeResume,
  isRetryableError,
  extractStatusCode,
  computeRetryDelay,
  executeWithRetry,
  getGeminiClient,
};
