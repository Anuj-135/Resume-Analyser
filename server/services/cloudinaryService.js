const cloudinary = require('cloudinary').v2;

// Initialize Cloudinary with environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Checks if Cloudinary is configured with non-placeholder credentials
 */
const isConfigured = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  return Boolean(
    cloudName &&
    cloudName !== 'placeholder' &&
    apiKey &&
    apiKey !== 'placeholder' &&
    apiSecret &&
    apiSecret !== 'placeholder'
  );
};

/**
 * Uploads an in-memory PDF buffer to Cloudinary as an authenticated raw asset.
 *
 * @param {Buffer} buffer - File buffer
 * @param {Object} [options] - Additional Cloudinary upload options
 * @returns {Promise<Object>} Cloudinary upload result object
 */
const uploadPdfBuffer = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      resource_type: 'raw',
      type: 'authenticated',
      folder: 'resumes',
      ...options,
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        return reject(error);
      }
      resolve(result);
    });

    stream.end(buffer);
  });
};

/**
 * Generates a short-lived authenticated download URL for a raw asset.
 * Uses Cloudinary's private_download_url with an expiring timestamp signature.
 *
 * @param {string} publicId - The exact public_id stored on the resume document
 * @param {number} [expiresInSeconds=3600] - Expiration duration in seconds (default 1 hour)
 * @returns {string} Short-lived signed download URL
 */
const generateSignedUrl = (publicId, expiresInSeconds = 3600) => {
  if (!publicId) return '';

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return cloudinary.utils.private_download_url(publicId, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: expiresAt,
  });
};

/**
 * Deletes an authenticated raw asset from Cloudinary using its exact public_id.
 * Parameters strictly match the upload configuration (raw + authenticated).
 *
 * @param {string} publicId - The exact public_id stored on the resume document
 * @returns {Promise<Object>} Cloudinary deletion result
 */
const deletePdfAsset = async (publicId) => {
  if (!publicId) return null;

  return cloudinary.uploader.destroy(publicId, {
    resource_type: 'raw',
    type: 'authenticated',
  });
};

module.exports = {
  cloudinary,
  isConfigured,
  uploadPdfBuffer,
  generateSignedUrl,
  deletePdfAsset,
};
