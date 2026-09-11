const mongoose = require('mongoose');

const resumeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    companyName: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    jobTitle: {
      type: String,
      required: [true, 'Job title is required'],
      trim: true,
    },
    jobDescription: {
      type: String,
      trim: true,
      default: '',
    },
    resumePath: {
      type: String,
      default: '',
    },
    imagePath: {
      type: String,
      default: '',
    },
    feedback: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    minimize: false,
  }
);

// Compound index for fast chronological querying per user
resumeSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Resume', resumeSchema);
