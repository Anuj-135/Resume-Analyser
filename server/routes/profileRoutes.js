const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getProfileAnalytics } = require('../controllers/profileController');

// All profile routes are protected by auth middleware
router.use(auth);

// GET /api/profile/analytics
router.get('/analytics', getProfileAnalytics);

module.exports = router;
