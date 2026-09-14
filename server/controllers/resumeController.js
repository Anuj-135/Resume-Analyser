const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Resume = require('../models/Resume');
const pdfService = require('../services/pdfService');
const aiService = require('../services/aiService');

const uploadDir = path.join(__dirname, '../uploads');

// Create a new resume record (supports multipart/form-data upload or JSON)
const createResume = async (req, res) => {
  try {
    const { companyName, jobTitle, jobDescription } = req.body;

    // Validate required text fields
    if (!companyName || !jobTitle || !companyName.trim() || !jobTitle.trim()) {
      if (req.file) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }
      return res.status(400).json({ message: 'Company name and job title are required' });
    }

    let resumePath = '';

    // Handle uploaded file if present
    if (req.file) {
      // Magic-byte verification: check for '%PDF-' signature
      try {
        const buffer = Buffer.alloc(5);
        const fd = await fs.promises.open(req.file.path, 'r');
        await fd.read(buffer, 0, 5, 0);
        await fd.close();

        if (buffer.toString('utf8', 0, 5) !== '%PDF-') {
          await fs.promises.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ message: 'Invalid PDF file signature' });
        }
      } catch (fileErr) {
        await fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ message: 'Failed to inspect uploaded file' });
      }

      // Server-controlled resumePath; never read req.body.resumePath
      resumePath = `/uploads/${req.file.filename}`;
    }

    // Strictly server-controlled fields:
    // - userId from req.userId
    // - resumePath is server-generated or empty
    // - imagePath is strictly '' in Phase 4
    // - feedback is strictly {} in Phase 4
    const resume = await Resume.create({
      userId: req.userId,
      companyName: companyName.trim(),
      jobTitle: jobTitle.trim(),
      jobDescription: jobDescription ? jobDescription.trim() : '',
      resumePath,
      imagePath: '',
      feedback: {},
    });

    return res.status(201).json({
      message: 'Resume created successfully',
      resume,
    });
  } catch (error) {
    console.error('Create resume error:', error);
    if (req.file) {
      await fs.promises.unlink(req.file.path).catch(() => {});
    }
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

// Delete a single resume by ID for the authenticated user, unlinking associated file
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

    // Clean up associated file from uploads directory if it exists
    if (resume.resumePath && resume.resumePath.startsWith('/uploads/')) {
      const filename = path.basename(resume.resumePath);
      const filePath = path.join(uploadDir, filename);
      await fs.promises.unlink(filePath).catch(() => {});
    }

    return res.status(200).json({ message: 'Resume deleted successfully' });
  } catch (error) {
    console.error('Delete resume error:', error);
    return res.status(500).json({ message: 'Server error deleting resume' });
  }
};

// Delete all resumes for the authenticated user, unlinking associated files (wipe data)
const deleteAllResumes = async (req, res) => {
  try {
    // Find all user's resumes to clean up their files
    const resumes = await Resume.find({ userId: req.userId });

    for (const resume of resumes) {
      if (resume.resumePath && resume.resumePath.startsWith('/uploads/')) {
        const filename = path.basename(resume.resumePath);
        const filePath = path.join(uploadDir, filename);
        await fs.promises.unlink(filePath).catch(() => {});
      }
    }

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

// Analyze an uploaded resume using Gemini AI
const analyzeResume = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid resume ID format' });
    }

    // Isolated ownership verification
    const resume = await Resume.findOne({ _id: id, userId: req.userId });

    if (!resume) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    if (!resume.resumePath) {
      return res.status(400).json({ message: 'Resume does not have an uploaded file to analyze' });
    }

    // Extract PDF text
    let resumeText;
    try {
      resumeText = await pdfService.extractTextFromPdf(resume.resumePath);
    } catch (extractErr) {
      if (extractErr.code === 'FILE_NOT_FOUND') {
        return res.status(404).json({ message: 'Stored resume file not found on server' });
      }
      if (extractErr.code === 'EMPTY_TEXT') {
        return res.status(422).json({ message: 'Resume PDF does not contain extractable text' });
      }
      if (extractErr.code === 'CORRUPTED_PDF' || extractErr.code === 'FILE_READ_ERROR') {
        return res.status(400).json({ message: 'Failed to extract text from resume PDF' });
      }
      return res.status(400).json({ message: extractErr.message || 'Error processing resume file' });
    }

    // Call AI Service
    let feedback;
    try {
      feedback = await aiService.analyzeResume({
        resumeText,
        companyName: resume.companyName,
        jobTitle: resume.jobTitle,
        jobDescription: resume.jobDescription,
      });
    } catch (aiErr) {
      console.error('AI analysis error:', aiErr.code || aiErr.message);
      const statusCode = aiErr.statusCode || 502;
      return res.status(statusCode).json({
        message: aiErr.code === 'AI_API_ERROR'
          ? 'AI analysis service is temporarily unavailable'
          : 'AI service returned an invalid response structure',
      });
    }

    // Persist validated feedback to MongoDB
    resume.feedback = feedback;
    await resume.save();

    return res.status(200).json({
      message: 'Resume analyzed successfully',
      feedback: resume.feedback,
    });
  } catch (error) {
    console.error('Analyze resume error:', error);
    return res.status(500).json({ message: 'Server error analyzing resume' });
  }
};

module.exports = {
  createResume,
  getResumes,
  getResumeById,
  deleteResume,
  deleteAllResumes,
  analyzeResume,
};
