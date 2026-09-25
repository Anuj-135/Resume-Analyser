/**
 * Profile Analytics Calculation Service
 * Computes derived resume metrics for the authenticated user.
 */

const THRESHOLDS = {
  HIGH: 75,
  MEDIUM: 50,
};

const isNumeric = (val) => typeof val === 'number' && Number.isFinite(val);

/**
 * Calculates category average across documents that contain a valid numeric score.
 *
 * @param {Array} resumes - List of analyzed resume documents
 * @param {Function} extractor - Function to extract the category score
 * @returns {number|null} Rounded average or null if no valid scores exist
 */
const calculateCategoryAverage = (resumes, extractor) => {
  let sum = 0;
  let count = 0;

  for (const r of resumes) {
    if (!r.feedback) continue;
    const score = extractor(r.feedback);
    if (isNumeric(score)) {
      sum += score;
      count += 1;
    }
  }

  return count > 0 ? Math.round(sum / count) : null;
};

/**
 * Derives comprehensive profile analytics from a user's resume records.
 *
 * @param {object} params
 * @param {Array} params.resumes - All raw Resume documents for the user
 * @param {object} params.user - User document { name, email, createdAt }
 * @returns {object} Calculated analytics and user details
 */
const calculateProfileAnalytics = ({ resumes = [], user = {} }) => {
  // Requirement: An "analysis" is defined as a Resume document with a valid numeric feedback.overallScore.
  // Documents without successful analyses are filtered out completely from analytics calculations.
  const analyzedResumes = resumes.filter(
    (r) => r.feedback && isNumeric(r.feedback.overallScore)
  );

  const totalAnalyses = analyzedResumes.length;

  const baseUser = {
    name: user.name || '',
    email: user.email || '',
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
  };

  // Safe empty state handling: return nulls and zeros without division by zero
  if (totalAnalyses === 0) {
    return {
      user: baseUser,
      analytics: {
        totalAnalyses: 0,
        averageScore: null,
        highestScore: null,
        lowestScore: null,
        scoreDistribution: {
          high: 0,
          medium: 0,
          low: 0,
        },
        categoryAverages: {
          ats: null,
          contentQuality: null,
          structure: null,
          toneAndStyle: null,
          keySkills: null,
        },
        recentAnalyses: [],
      },
    };
  }

  // Derive scores
  const scores = analyzedResumes.map((r) => r.feedback.overallScore);
  const totalScoreSum = scores.reduce((acc, curr) => acc + curr, 0);

  const averageScore = Math.round(totalScoreSum / totalAnalyses);
  const highestScore = Math.max(...scores);
  const lowestScore = Math.min(...scores);

  // Distribution using centralized application thresholds:
  // High: >= 75 | Medium: >= 50 && < 75 | Low: < 50
  const scoreDistribution = {
    high: scores.filter((s) => s >= THRESHOLDS.HIGH).length,
    medium: scores.filter((s) => s >= THRESHOLDS.MEDIUM && s < THRESHOLDS.HIGH).length,
    low: scores.filter((s) => s < THRESHOLDS.MEDIUM).length,
  };

  // Category averages (each divided by count of documents containing that category score)
  const categoryAverages = {
    ats: calculateCategoryAverage(
      analyzedResumes,
      (f) => f.ATS?.score ?? f.ats?.score
    ),
    contentQuality: calculateCategoryAverage(
      analyzedResumes,
      (f) => f.content?.score
    ),
    structure: calculateCategoryAverage(
      analyzedResumes,
      (f) => f.structure?.score
    ),
    toneAndStyle: calculateCategoryAverage(
      analyzedResumes,
      (f) => f.toneAndStyle?.score
    ),
    keySkills: calculateCategoryAverage(
      analyzedResumes,
      (f) => f.skills?.score
    ),
  };

  // Recent analyses (top 5 latest analyzed resumes)
  // Ensure reverse chronological sort
  const sortedAnalyzed = [...analyzedResumes].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  const recentAnalyses = sortedAnalyzed.slice(0, 5).map((r) => ({
    id: r._id.toString(),
    companyName: r.companyName || '',
    jobTitle: r.jobTitle || '',
    score: r.feedback.overallScore,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));

  return {
    user: baseUser,
    analytics: {
      totalAnalyses,
      averageScore,
      highestScore,
      lowestScore,
      scoreDistribution,
      categoryAverages,
      recentAnalyses,
    },
  };
};

module.exports = {
  THRESHOLDS,
  calculateProfileAnalytics,
  calculateCategoryAverage,
};
