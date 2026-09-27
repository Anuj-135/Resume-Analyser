const mongoose = require('mongoose');
const Resume = require('../models/Resume');
const pdfService = require('../services/pdfService');
const aiService = require('../services/aiService');
const cloudinaryService = require('../services/cloudinaryService');

// Create a new resume record (supports multipart/form-data upload or JSON)
const createResume = async (req, res) => {
  let uploadedPublicId = '';
  try {
    const { companyName, jobTitle, jobDescription } = req.body;

    // Validate required text fields
    if (!companyName || !jobTitle || !companyName.trim() || !jobTitle.trim()) {
      return res.status(400).json({ message: 'Company name and job title are required' });
    }

    let resumePublicId = '';

    // Handle uploaded file if present (in-memory buffer from multer.memoryStorage)
    if (req.file) {
      // Magic-byte verification: check for '%PDF-' signature directly on buffer
      if (
        !req.file.buffer ||
        req.file.buffer.length < 5 ||
        req.file.buffer.subarray(0, 5).toString('utf8') !== '%PDF-'
      ) {
        return res.status(400).json({ message: 'Invalid PDF file signature' });
      }

      // Stream in-memory buffer to Cloudinary as authenticated raw asset
      const uploadResult = await cloudinaryService.uploadPdfBuffer(req.file.buffer);

      // Store exact result.public_id returned by Cloudinary without modification
      resumePublicId = uploadResult.public_id;
      uploadedPublicId = resumePublicId;
    }

    // Strictly server-controlled fields:
    // - userId from req.userId
    // - resumePublicId is Cloudinary public_id or empty
    // - imagePath is strictly ''
    // - feedback is strictly {}
    const resume = await Resume.create({
      userId: req.userId,
      companyName: companyName.trim(),
      jobTitle: jobTitle.trim(),
      jobDescription: jobDescription ? jobDescription.trim() : '',
      resumePublicId,
      imagePath: '',
      feedback: {},
    });

    return res.status(201).json({
      message: 'Resume created successfully',
      resume,
    });
  } catch (error) {
    console.error('Create resume error:', error);
    // If upload to Cloudinary succeeded but document creation failed, roll back the Cloudinary asset
    if (uploadedPublicId) {
      await cloudinaryService.deletePdfAsset(uploadedPublicId).catch(() => {});
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

    // Isolated ownership verification
    const resume = await Resume.findOne({ _id: id, userId: req.userId });

    if (!resume) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    const resumeData = resume.toObject();

    // Generate short-lived authenticated download URL on demand after ownership check
    if (resume.resumePublicId) {
      resumeData.resumeUrl = cloudinaryService.generateSignedUrl(resume.resumePublicId);
    }

    return res.status(200).json({ resume: resumeData });
  } catch (error) {
    console.error('Fetch resume by ID error:', error);
    return res.status(500).json({ message: 'Server error fetching resume' });
  }
};

// Delete a single resume by ID for the authenticated user, deleting associated Cloudinary asset
const deleteResume = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid resume ID format' });
    }

    // Isolated ownership verification and atomic delete
    const resume = await Resume.findOneAndDelete({ _id: id, userId: req.userId });

    if (!resume) {
      return res.status(404).json({ message: 'Resume not found' });
    }

    // Clean up associated authenticated raw asset from Cloudinary using exact stored public_id
    if (resume.resumePublicId) {
      await cloudinaryService.deletePdfAsset(resume.resumePublicId).catch((err) => {
        console.error('Error deleting asset from Cloudinary:', err);
      });
    }

    return res.status(200).json({ message: 'Resume deleted successfully' });
  } catch (error) {
    console.error('Delete resume error:', error);
    return res.status(500).json({ message: 'Server error deleting resume' });
  }
};

// Delete all resumes for the authenticated user, deleting associated Cloudinary assets (wipe data)
const deleteAllResumes = async (req, res) => {
  try {
    // Find all user's resumes to clean up their Cloudinary assets
    const resumes = await Resume.find({ userId: req.userId });

    for (const resume of resumes) {
      if (resume.resumePublicId) {
        await cloudinaryService.deletePdfAsset(resume.resumePublicId).catch((err) => {
          console.error('Error deleting asset from Cloudinary during wipe:', err);
        });
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

    if (!resume.resumePublicId) {
      return res.status(400).json({ message: 'Resume does not have an uploaded file to analyze' });
    }

    // Extract PDF text from Cloudinary authenticated raw asset
    let resumeText;
    try {
      resumeText = await pdfService.extractTextFromPdf(resume.resumePublicId);
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
