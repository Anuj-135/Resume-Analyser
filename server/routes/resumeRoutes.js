const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const uploadResumeFile = require('../middleware/upload');
const validate = require('../middleware/validate');
const { createResumeBodySchema, resumeIdParamSchema } = require('../schemas/resumeSchemas');
const {
  analysisLimiter,
  globalAnalysisLimiter,
  uploadIpLimiter,
  uploadUserLimiter,
} = require('../middleware/rateLimiter');
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

router.post(
  '/',
  uploadIpLimiter,
  uploadUserLimiter,
  uploadResumeFile,
  validate({ body: createResumeBodySchema }),
  createResume
);
router.post(
  '/:id/analyze',
  validate({ params: resumeIdParamSchema }),
  globalAnalysisLimiter,
  analysisLimiter,
  analyzeResume
);
router.get('/', getResumes);
router.get('/:id', validate({ params: resumeIdParamSchema }), getResumeById);
router.delete('/:id', validate({ params: resumeIdParamSchema }), deleteResume);
router.delete('/', deleteAllResumes);

module.exports = router;
