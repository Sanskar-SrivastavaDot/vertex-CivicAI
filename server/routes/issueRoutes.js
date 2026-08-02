const express = require('express');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');
const path = require('path');
const fs = require('fs');
const {
  createIssue,
  getAllIssues,
  updateIssueStatus,
  getHeatmapData,
  getMyIssues,
  getIssueAnalysisStatus,
  overrideWorkforceEstimate,
  recordResolution,
} = require('../controllers/issueController');
const { authMiddleware, roleMiddleware, optionalAuth } = require('../middleware/authMiddleware');

const router = express.Router();

// ─── Upload Storage: Cloudinary (prod) → local disk (dev fallback) ────────────
// If Cloudinary is configured, photos go to the cloud. Otherwise (local testing
// without credentials) they save to server/uploads/ and are served statically.
const cloudReady = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

let storage;
if (cloudReady) {
  storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'civicai_issues',
      allowed_formats: ['jpeg', 'jpg', 'png', 'gif', 'webp'],
    },
  });
  console.log('☁️  Image uploads → Cloudinary');
} else {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `issue_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    },
  });
  console.log('💾 Image uploads → local disk (dev fallback, no Cloudinary configured)');
}

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname || '').toLowerCase();
  // Some clients (mobile webviews, scripted uploads) send an empty mimetype;
  // fall back to the file extension so legitimate uploads are not rejected.
  if (allowedTypes.includes(file.mimetype) || (!file.mimetype && allowedExt.includes(ext))) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, png, gif, webp)'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Public GET routes (map visible to all) — optional auth enriches GOV responses
// with reporter contact info, while anonymous access stays fully readable.
router.get('/heatmap', getHeatmapData);
router.get('/', optionalAuth, getAllIssues);

// Citizen only — get only their own issues (for profile page)
router.get(
  '/my',
  authMiddleware,
  roleMiddleware(['Citizen']),
  getMyIssues
);

// Analysis status polling — authenticated (owner or GOV gets full detail)
router.get('/:id/status', authMiddleware, getIssueAnalysisStatus);

// Citizen only — submit a new grievance (returns 202; AI runs in background)
router.post(
  '/',
  authMiddleware,
  roleMiddleware(['Citizen']),
  upload.single('image'),
  createIssue
);

// GOV only — advance grievance status
router.put(
  '/:id',
  authMiddleware,
  roleMiddleware(['GOV']),
  updateIssueStatus
);

// GOV only — override AI workforce estimate
router.put(
  '/:id/workforce',
  authMiddleware,
  roleMiddleware(['GOV']),
  overrideWorkforceEstimate
);

// GOV only — record actual resolution data (trains the historical model)
router.put(
  '/:id/resolution',
  authMiddleware,
  roleMiddleware(['GOV']),
  recordResolution
);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
