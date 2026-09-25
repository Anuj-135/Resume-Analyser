const User = require('../models/User');
const Resume = require('../models/Resume');
const { calculateProfileAnalytics } = require('../services/profileAnalyticsService');

/**
 * Controller to fetch profile and resume analytics for the authenticated user.
 * Strictly uses req.userId from the auth middleware token.
 */
const getProfileAnalytics = async (req, res) => {
  try {
    // 1. Fetch user account information (never include password or secrets)
    const user = await User.findById(req.userId).select('name email createdAt');
    if (!user) {
      return res.status(404).json({ message: 'User account not found' });
    }

    // 2. Fetch all resumes strictly for the authenticated user, sorted latest first
    const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });

    // 3. Compute derived metrics through dedicated service
    const payload = calculateProfileAnalytics({ resumes, user });

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching profile analytics:', error);
    return res.status(500).json({ message: 'Server error retrieving profile analytics' });
  }
};

module.exports = {
  getProfileAnalytics,
};
