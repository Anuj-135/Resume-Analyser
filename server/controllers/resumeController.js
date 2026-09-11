const mongoose = require('mongoose');
const Resume = require('../models/Resume');

// Create a new resume record (metadata only in Phase 3)
const createResume = async (req, res) => {
  try {
    const { companyName, jobTitle, jobDescription, resumePath, imagePath, feedback } = req.body;

    if (!companyName || !jobTitle || !companyName.trim() || !jobTitle.trim()) {
      return res.status(400).json({ message: 'Company name and job title are required' });
    }

    const resume = await Resume.create({
      userId: req.userId,
      companyName: companyName.trim(),
      jobTitle: jobTitle.trim(),
      jobDescription: jobDescription ? jobDescription.trim() : '',
      resumePath: resumePath || '',
      imagePath: imagePath || '',
      feedback: feedback || {},
    });

    return res.status(201).json({
      message: 'Resume created successfully',
      resume,
    });
  } catch (error) {
    console.error('Create resume error:', error);
    return res.status(500).json({ message: 'Server error creating resume' });
  }
};

// List all resumes for the authenticated user
const getResumes = async (req, res) => {
  try {
    const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      count: resumes.length,
      resumes,
    });
  } catch (error) {
    console.error('Fetch resumes error:', error);
    return res.status(500).json({ message: 'Server error fetching resumes' });
  }
};

// Fetch a single resume by ID for the authenticated user
const getResumeById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid resume ID format' });
    }

    const resume = await Resume.findOne({ _id: id, userId: req.userId });

    if (!resume) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    return res.status(200).json({ resume });
  } catch (error) {
    console.error('Fetch resume by ID error:', error);
    return res.status(500).json({ message: 'Server error fetching resume' });
  }
};

// Delete a single resume by ID for the authenticated user
const deleteResume = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid resume ID format' });
    }

    const resume = await Resume.findOneAndDelete({ _id: id, userId: req.userId });

    if (!resume) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    return res.status(200).json({ message: 'Resume deleted successfully' });
  } catch (error) {
    console.error('Delete resume error:', error);
    return res.status(500).json({ message: 'Server error deleting resume' });
  }
};

// Delete all resumes for the authenticated user (wipe data)
const deleteAllResumes = async (req, res) => {
  try {
    const result = await Resume.deleteMany({ userId: req.userId });

    return res.status(200).json({
      message: 'All resumes deleted successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Delete all resumes error:', error);
    return res.status(500).json({ message: 'Server error deleting all resumes' });
  }
};

module.exports = {
  createResume,
  getResumes,
  getResumeById,
  deleteResume,
  deleteAllResumes,
};
