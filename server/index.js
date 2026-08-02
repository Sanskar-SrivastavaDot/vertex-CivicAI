require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

const issueRoutes = require('./routes/issueRoutes');
const authRoutes = require('./routes/authRoutes');
const routeRoutes = require('./routes/routeRoutes');
const { recoverStuckIssues } = require('./services/analysisQueue');
const app = express();
const PORT = process.env.PORT || 5000;

// ─── Proxy & Middleware ─────────────────────────────────────────────────────────
// Behind Render/Vercel proxy — required so rate limits key on the real client IP.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
  origin: [
    process.env.CLIENT_URL,
    'https://vertex-ashy.vercel.app',
    'http://localhost:5173'
  ].filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Rate limiting ───────────────────────────────────────────────────────────────
const skipHealth = (req) => req.path === '/api/health';

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipHealth,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use(globalLimiter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});
app.use('/api/auth/login', loginLimiter);

// Issue submission — keyed by user id when authed (CGNAT-safe), IP otherwise
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req),
  message: { error: 'Too many issue submissions. Please try again later.' },
});
app.use('/api/issues', uploadLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/routes', routeRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    db: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
    ai: process.env.GROQ_API_KEY ? 'groq_configured' : 'mock_mode',
    queue: 'in_process',
  });
});

// ─── Database & Server Start ──────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/civicai')
  .then(() => {
    console.log('✅ MongoDB connected');
    // Re-enqueue any issues left pending by a previous server process
    recoverStuckIssues();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
