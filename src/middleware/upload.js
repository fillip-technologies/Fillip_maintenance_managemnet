import multer from 'multer';
import { Readable } from 'node:stream';
import { cloudinary, cloudinaryReady } from '../config/cloudinary.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';

// Memory storage — files are held in Buffer, then streamed to Cloudinary.
const storage = multer.memoryStorage();

/** Allow images and videos only; reject everything else. */
function fileFilter(_req, file, cb) {
  if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Only image and video files are allowed', { code: 'INVALID_FILE_TYPE' }));
  }
}

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB per file
    files: 5,                    // max 5 files per request
  },
});

/**
 * Stream a buffer to Cloudinary.
 * Returns the Cloudinary upload result `{ secure_url, public_id, resource_type }`.
 */
export function streamToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'fixly/issues', ...options },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    Readable.from(buffer).pipe(stream);
  });
}

/**
 * Upload all files attached to a request (req.files or req.file) to Cloudinary.
 * Returns an array of attachment objects `{ url, publicId, type, filename }`.
 * No-ops (returns []) when Cloudinary is not configured.
 */
export async function uploadRequestFiles(req) {
  if (!cloudinaryReady()) {
    logger.warn('Cloudinary not configured — file attachments skipped');
    return [];
  }

  const files = Array.isArray(req.files)
    ? req.files
    : req.files
    ? Object.values(req.files).flat()
    : req.file
    ? [req.file]
    : [];

  if (files.length === 0) return [];

  const results = await Promise.all(
    files.map(async (file) => {
      const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const result = await streamToCloudinary(file.buffer, { resource_type: resourceType });
      return {
        url:          result.secure_url,
        publicId:     result.public_id,
        type:         resourceType,
        filename:     file.originalname,
        uploadedAt:   new Date().toISOString(),
      };
    })
  );

  return results;
}
