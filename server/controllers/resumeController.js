const mongoose = require('mongoose');
const Resume = require('../models/Resume');
const pdfService = require('../services/pdfService');
const aiService = require('../services/aiService');
const cloudinaryService = require('../services/cloudinaryService');

// In-memory set tracking active resume analyses by unambiguous composite [userId, resumeId] key
const activeAnalyses = new Set();

// Create a new resume record (supports multipart/form-data upload or JSON)
const createResume = async (req, res, next) => {
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
    // If upload to Cloudinary succeeded but document creation failed, roll back the Cloudinary asset
    if (uploadedPublicId) {
      await cloudinaryService.deletePdfAsset(uploadedPublicId).catch(() => {
        console.error('[Cloudinary Cleanup] Failed to delete asset during rollback');
      });
    }
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Create resume failure');
    return res.status(500).json({ message: 'Server error creating resume' });
  }
};

// List all resumes for the authenticated user
const getResumes = async (req, res, next) => {
  try {
    const resumes = await Resume.find({ userId: req.userId }).sort({ createdAt: -1 });

    return res.status(200).json({
      count: resumes.length,
      resumes,
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Fetch resumes failure');
    return res.status(500).json({ message: 'Server error fetching resumes' });
  }
};

// Fetch a single resume by ID for the authenticated user
const getResumeById = async (req, res, next) => {
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
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Fetch resume by ID failure');
    return res.status(500).json({ message: 'Server error fetching resume' });
  }
};

// Delete a single resume by ID for the authenticated user, deleting associated Cloudinary asset
const deleteResume = async (req, res, next) => {
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
      await cloudinaryService.deletePdfAsset(resume.resumePublicId).catch(() => {
        console.error('[Cloudinary Cleanup] Failed to delete asset during resume deletion');
      });
    }

    return res.status(200).json({ message: 'Resume deleted successfully' });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Delete resume failure');
    return res.status(500).json({ message: 'Server error deleting resume' });
  }
};

// Delete all resumes for the authenticated user, deleting associated Cloudinary assets (wipe data)
const deleteAllResumes = async (req, res, next) => {
  try {
    // Find all user's resumes to clean up their Cloudinary assets
    const resumes = await Resume.find({ userId: req.userId });

    for (const resume of resumes) {
      if (resume.resumePublicId) {
        await cloudinaryService.deletePdfAsset(resume.resumePublicId).catch(() => {
          console.error('[Cloudinary Cleanup] Failed to delete asset during wipe');
        });
      }
    }

    const result = await Resume.deleteMany({ userId: req.userId });

    return res.status(200).json({
      message: 'All resumes deleted successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Delete all resumes failure');
    return res.status(500).json({ message: 'Server error deleting all resumes' });
  }
};

// Analyze an uploaded resume using Gemini AI
const analyzeResume = async (req, res, next) => {
  const { id } = req.params;

  // Unambiguous serialization of [userId, resumeId]
  const lockKey = JSON.stringify([String(req.userId), String(id)]);

  // Synchronously check and acquire lock before any asynchronous operations
  if (activeAnalyses.has(lockKey)) {
    return res.status(409).json({ message: 'Analysis already in progress for this resume' });
  }

  activeAnalyses.add(lockKey);

  try {
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
      if (extractErr.code === 'DOWNLOAD_TIMEOUT') {
        return res.status(504).json({ message: 'Timed out retrieving resume from storage' });
      }
      if (extractErr.code === 'TEXT_TOO_LONG') {
        return res.status(400).json({ message: 'Resume text exceeds maximum allowed length of 50,000 characters' });
      }
      if (extractErr.code === 'CORRUPTED_PDF' || extractErr.code === 'FILE_READ_ERROR') {
        return res.status(400).json({ message: 'Failed to extract text from resume PDF' });
      }
      return res.status(400).json({ message: 'Error processing resume file' });
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
      console.error('[AI Service] Analysis failure with code:', aiErr.code || 'UNKNOWN');

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
    if (typeof next === 'function') {
      return next(error);
    }
    console.error('[Resume Error] Analyze resume failure');
    return res.status(500).json({ message: 'Server error analyzing resume' });
  } finally {
    activeAnalyses.delete(lockKey);
  }
};

module.exports = {
  createResume,
  getResumes,
  getResumeById,
  deleteResume,
  deleteAllResumes,
  analyzeResume,
  _activeAnalyses: activeAnalyses,
};
