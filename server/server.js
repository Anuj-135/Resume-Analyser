const path = require('path');
require('dotenv').config();
const { validateEnv } = require('./config/env');

// Validate environment variables immediately at startup before service initialization
validateEnv();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/db');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Reverse proxy configuration: trust first hop only when running behind Render or in production
if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true' || process.env.RENDER === true) {
  app.set('trust proxy', 1);
}

// Security headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: {
      maxAge: 15552000,
      includeSubDomains: false,
    },
  })
);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
  exposedHeaders: [
    'Retry-After',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
    'RateLimit-Policy',
    'RateLimit',
  ],
}));
app.use(cookieParser());
app.use(express.json());


// Routes
const authRoutes = require('./routes/authRoutes');
const resumeRoutes = require('./routes/resumeRoutes');
const profileRoutes = require('./routes/profileRoutes');

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is healthy',
    timestamp: new Date().toISOString()
  });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/profile', profileRoutes);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Centralized error-handling middleware
app.use(errorHandler);

// Start server after successful database connection
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

startServer();

