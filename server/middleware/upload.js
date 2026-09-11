const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Disk storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate secure, collision-proof filename: resume-<timestamp>-<randomHex>.pdf
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `resume-${uniqueSuffix}.pdf`);
  },
});

// File filter: strictly allow PDF files only
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf' || file.mimetype !== 'application/pdf') {
    const error = new Error('Only PDF files are allowed');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }
  cb(null, true);
};

// Multer upload instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1,
  },
});

// Wrapped middleware for clean error responses (400 instead of crashing or leaking 500)
const uploadResumeFile = (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'File size exceeds limit of 10MB' });
      }
      if (err.code === 'INVALID_FILE_TYPE' || err.message === 'Only PDF files are allowed') {
        return res.status(400).json({ message: 'Only PDF files are allowed' });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Unexpected field in form upload' });
      }
      return res.status(400).json({ message: err.message || 'File upload error' });
    }
    next();
  });
};

module.exports = uploadResumeFile;
