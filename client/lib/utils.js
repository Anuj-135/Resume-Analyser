import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs))
}

export function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    // Determine the appropriate unit by calculating the log
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Format with 2 decimal places and round
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const generateUUID = () => crypto.randomUUID();

export function getSafeRedirectUrl(nextParam) {
  if (!nextParam || typeof nextParam !== 'string') return '/';
  if (nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes(':')) {
    return nextParam;
  }
  return '/';
}

/**
 * Maximum safe Retry-After duration in seconds (1 year).
 * Any values exceeding this or unsafe integers are rejected as corrupted/malformed.
 */
const MAX_SAFE_RETRY_AFTER_SECONDS = 31536000;

/**
 * Strictly parses a Retry-After response header.
 * Conforms to RFC 9110 / RFC 7231:
 * - Accepts non-negative integer delta-seconds (e.g. "120", "0")
 * - Strictly rejects malformed numeric prefixes (e.g. "30abc", "-5", "12.5")
 * - Rejects unsafe integers or unreasonably large durations
 * - Accepts valid HTTP-date strings; returns delta-seconds or 0 if expired
 * - Safely returns null on missing, invalid, or unparseable headers without throwing
 *
 * @param {object} headers - Axios or fetch response headers dictionary
 * @returns {number|null} - Non-negative integer seconds remaining, or null
 */
export function parseRetryAfterHeader(headers) {
  if (!headers || typeof headers !== 'object') return null;

  const rawValue = headers['retry-after'] || headers['Retry-After'];
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return null;

  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;

  // 1. Strict non-negative integer delta-seconds: must consist entirely of digits
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (
      Number.isSafeInteger(seconds) &&
      seconds >= 0 &&
      seconds <= MAX_SAFE_RETRY_AFTER_SECONDS
    ) {
      return seconds; // 0 is valid and preserved
    }
    return null;
  }

  // 2. HTTP-date format parsing (e.g. "Wed, 21 Oct 2026 07:28:00 GMT")
  // Must match an HTTP-date candidate (contains standard month abbreviation and time colons)
  // to prevent overly-lenient Date.parse from interpreting negative numbers or decimals as dates
  const isHttpDateCandidate =
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(trimmed) &&
    /:\d{2}/.test(trimmed);

  if (isHttpDateCandidate) {
    const dateTimestamp = Date.parse(trimmed);
    if (!isNaN(dateTimestamp)) {
      const diffSeconds = Math.ceil((dateTimestamp - Date.now()) / 1000);
      if (diffSeconds <= 0) {
        return 0; // Expired date returns 0
      }
      if (
        Number.isSafeInteger(diffSeconds) &&
        diffSeconds <= MAX_SAFE_RETRY_AFTER_SECONDS
      ) {
        return diffSeconds;
      }
    }
  }

  return null;
}

/**
 * Formats retry seconds into user-friendly text.
 * Explicitly differentiates between 0 (immediate) and null (unknown).
 *
 * @param {number|null} seconds
 * @returns {string|null}
 */
export function formatRetryTime(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return 'immediately';
  if (seconds <= 60) return 'less than a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `approximately ${minutes} minute${minutes > 1 ? 's' : ''}`;
  const hours = Math.round(minutes / 60);
  return `approximately ${hours} hour${hours > 1 ? 's' : ''}`;
}

/**
 * Verifies whether a resume has completed analysis based on actual Mongoose model
 * and Gemini AI response schema.
 *
 * @param {object} feedback
 * @returns {boolean}
 */
export function isAnalysisComplete(feedback) {
  if (!feedback || typeof feedback !== 'object') return false;
  return (
    typeof feedback.overallScore === 'number' &&
    Number.isFinite(feedback.overallScore) &&
    Object.keys(feedback).length > 0
  );
}

