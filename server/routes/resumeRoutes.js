const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  createResume,
  getResumes,
  getResumeById,
  deleteResume,
  deleteAllResumes,
} = require('../controllers/resumeController');

// All resume routes are protected by auth middleware
router.use(auth);

router.post('/', createResume);
router.get('/', getResumes);
router.get('/:id', getResumeById);
router.delete('/:id', deleteResume);
router.delete('/', deleteAllResumes);

module.exports = router;
