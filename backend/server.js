// Load environment variables early
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const passport = require('./config/passport');
const cookieSession = require('cookie-session');

// ────────────────────────────────────────────────────────────
// 🔐 Fail fast if required secrets are missing
// ────────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error(
    'FATAL: JWT_SECRET is not set.\n' +
    'Generate one with:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n'
  );
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error('FATAL: MONGO_URI is not set.');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────
// 🛡️ Process-level safety nets
// Node ≥15 terminates the process on ANY unhandled promise rejection.
// One stray rejection (provider hiccup, socket race, callback miss) must
// not silently kill the whole API — log loudly and keep serving. The log
// line is what we use to find and fix the actual offender.
// ────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection (server kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception (server kept alive):', err);
});

// DB Connection
const connectDB = require('./config/db');
connectDB();

// Social migrations (Part 3) — idempotent, runs once the DB is connected
require('./migrations/social.migration').ensureUsernames();

// Initialize Express
const app = express();

// Behind Render's proxy, honor X-Forwarded-* headers (needed for rate limiting)
app.set('trust proxy', 1);

// ────────────────────────────────────────────────────────────
// 🛡️ Security headers
// ────────────────────────────────────────────────────────────
app.use(
  helmet({
    // Event posters/avatars are served cross-origin to the frontend
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // API only; CSP belongs on the frontend
  })
);

// ────────────────────────────────────────────────────────────
// 🩺 Request context + compression (Part 5, Phase 1)
// requestId, structured access logs, latency metrics (§56–57);
// HTTP compression for text responses (§46).
// ────────────────────────────────────────────────────────────
app.use(require('./middleware/request-context').requestContext);

let compression = null;
try {
  compression = require('compression');
} catch (_err) {
  // Graceful degradation (§68): a stale node_modules must not crash boot —
  // run `npm i` to pick the dependency up.
  console.warn('[boot] compression not installed — serving uncompressed. Run: npm i');
}
if (compression) {
  app.use(compression({ filter: (req, res) => (req.path.startsWith('/uploads') ? false : compression.filter(req, res)) }));
}

// ────────────────────────────────────────────────────────────
// 🚦 Rate limiting
// ────────────────────────────────────────────────────────────
// Part 5, Phase 2 — per-domain rate limits (§24). All numbers live in
// config/rate-limits.js — one source of truth, env-overridable.
// READ (generous) on /api; AUTH / SEARCH / UPLOAD at prefix level;
// SOCIAL / MESSAGING / EVENT are action-scoped inside their route files.
// 429s flow through the error normalizer: RATE_LIMITED + Retry-After (§25).
const { applyGlobalRateLimits } = require('./config/rate-limits');
applyGlobalRateLimits(app);

// ────────────────────────────────────────────────────────────
// 🧰 Middleware
// ────────────────────────────────────────────────────────────

// CORS — supports multiple origins via comma-separated FRONTEND_URL
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ────────────────────────────────────────────────────────────
// 🗄️ HTTP cache policy (Part 5, Phase 1 — §47–48)
// Public anonymous GETs: short shared cache + SWR window (browsers
// and any future CDN may reuse). Anything authenticated, and every
// non-GET: never publicly cacheable. Express's default weak ETags
// stay on, so conditional requests still get 304s.
// ────────────────────────────────────────────────────────────
const PUBLIC_GET_PREFIXES = ['/api/events', '/api/organizations', '/api/communities', '/api/search', '/api/health'];
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/admin')) {
    res.set('Cache-Control', 'private, no-store');
    return next();
  }
  const anonymous = !req.headers.authorization;
  const isPublicRoute = PUBLIC_GET_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'));
  res.set(
    'Cache-Control',
    anonymous && isPublicRoute
      ? 'public, max-age=30, stale-while-revalidate=120'
      : 'private, no-store'
  );
  next();
});

// Body parsers
// Input limits (§63): JSON APIs never legitimately approach 1MB — file
// uploads travel as multipart (5MB cap in upload.routes), not JSON.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Local static uploads (legacy files still served; new uploads go to Cloudinary)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Cookie session for the Google OAuth passport flow
app.use(
  cookieSession({
    name: 'session',
    keys: [process.env.JWT_SECRET],
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
);

app.use(passport.initialize());

// ────────────────────────────────────────────────────────────
// 📦 Routes
// ────────────────────────────────────────────────────────────
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth', require('./routes/google.routes'));
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/registration', require('./routes/registration.routes'));
app.use('/api/tickets', require('./routes/ticket.routes'));
app.use('/api/posts', require('./routes/post.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/messages', require('./routes/message.routes'));
app.use('/api/quizzes', require('./routes/quiz.routes'));
app.use('/api/follow', require('./routes/follow.routes'));
app.use('/api/organizations', require('./routes/organization.routes'));
app.use('/api/communities', require('./routes/community.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/blocks', require('./routes/block.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/moderation', require('./routes/moderation.routes'));
app.use('/api/search', require('./routes/search.routes'));
app.use('/api', require('./routes/activity.routes'));

// ────────────────────────────────────────────────────────────
// 🧭 Health check
// ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('🚀 EventHub API is running!');
});

app.get('/api/health', (req, res) => {
  const mongoose = require('mongoose');
  /* §61 — this route is PUBLIC, so it says "up" and nothing more.
   * Cache occupancy, latency percentiles, provider state and every other
   * internal figure were removed from here and live behind
   * GET /api/admin/infrastructure (requireAuth + requireAdmin). Advertising
   * cache size and configuration to anonymous callers is infrastructure
   * detail they have no reason to see. */
  res.json({
    status: 'OK',
    service: 'eventhub-api',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'degraded',
  });
});

// ────────────────────────────────────────────────────────────
// 🪄 Error handling — normalized taxonomy (Part 5, §61/§67)
// One exit shape: { success, message, error: { code, message } }.
// Internal details (stacks, provider/Mongo errors) are logged
// server-side with the requestId — NEVER sent to clients.
// `message` stays top-level for backward compatibility with the
// existing frontend; new code should read `error.code`.
// ────────────────────────────────────────────────────────────
const { errorResponse } = require('./utils/app-error');
app.use((error, req, res, next) => {
  const normalized = errorResponse(error);
  if (normalized.status >= 500) {
    console.error(`[error] ${req.id || '-'} ${req.method} ${req.path}:`, error?.message || error);
  }
  if (normalized.retryAfterMs) {
    res.set('Retry-After', Math.ceil(normalized.retryAfterMs / 1000));
  }
  res.status(normalized.status).json(normalized.body);
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ────────────────────────────────────────────────────────────
// 📁 Ensure required directories exist
// ────────────────────────────────────────────────────────────
const requiredDirs = ['uploads'];
requiredDirs.forEach((dir) => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📂 Created missing directory: ${dirPath}`);
  }
});

// ────────────────────────────────────────────────────────────
// 🚀 Start Server
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

// ────────────────────────────────────────────────────────────
// 🔴 LIVE EVENT ENGINE — HTTP server + Socket.IO (Part 4)
// One realtime framework only (spec §1); io is passed to the
// realtime service which owns rooms, presence and commands.
// ────────────────────────────────────────────────────────────
const http = require("http");
const { Server } = require("socket.io");
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
});
require("./services/realtime.service").init(io);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ EventHub API running on port ${PORT}`);
  // Event reminder scheduler (Part 3, Phase 8) — in-process, deduped
  require("./services/reminder.service").startReminderScheduler();
});
