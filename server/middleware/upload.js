const multer = require('multer');
const path = require('path');

// In-memory storage engine: stream buffers directly to Cloudinary without writing to local disk
const storage = multer.memoryStorage();



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
