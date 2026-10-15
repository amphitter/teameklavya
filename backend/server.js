// Load environment variables early
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { uploadsDir } = require('./services/storage.provider');
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
// ────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection (server kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception (server kept alive):', err);
});

// DB + migrations — imported but not executed until boot (Priority 4 fix)
const connectDB = require('./config/db');
const socialMigration = require('./migrations/social.migration');
const conversationMigration = require('./migrations/conversation-index.migration');
const organizationMigration = require('./migrations/organization-indexes.migration');
const asiaMigration = require('./migrations/asia-performance-indexes.migration');

async function initializeDatabase() {
  await connectDB();
  try {
    await socialMigration.ensureUsernames();
    console.log('[boot] social migration ok');
  } catch (e) {
    console.warn('[boot] social migration failed:', e.message);
  }
  try {
    await conversationMigration.ensureConversationIndexes();
    console.log('[boot] conversation indexes ok');
  } catch (e) {
    console.warn('[boot] conversation indexes failed:', e.message);
  }
  try {
    await organizationMigration.ensureOrganizationIndexes();
    console.log('[boot] organization indexes ok');
  } catch (e) {
    console.warn('[boot] organization indexes failed:', e.message);
  }
  try {
    await asiaMigration.ensureAsiaIndexes();
    console.log('[boot] asia indexes ok');
  } catch (e) {
    console.warn('[boot] asia indexes failed:', e.message);
  }
}

// Initialize Express
const app = express();

// Behind Render's proxy, honor X-Forwarded-* headers (needed for rate limiting)
// Render sits behind 1 proxy by default; if behind Cloudflare + Render, set TRUST_PROXY=2
// Verify via logs of X-Forwarded-For. Keep 1 as safe default for Render.
const trustProxyValue = Number(process.env.TRUST_PROXY) || 1;
app.set('trust proxy', trustProxyValue);

// ────────────────────────────────────────────────────────────
// 🧰 CORS — MUST be before rate limiting and auth (Priority 1 fix)
// Supports multiple origins via comma-separated FRONTEND_URL
// Normalizes trailing slashes and auto-includes apex + www variants
// ────────────────────────────────────────────────────────────
function normalizeOrigin(o) {
  if (!o) return null;
  let s = String(o).trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

function expandOrigins(origins) {
  const set = new Set();
  for (const raw of origins) {
    const norm = normalizeOrigin(raw);
    if (!norm) continue;
    set.add(norm);
    try {
      const url = new URL(norm);
      const host = url.hostname;
      if (host === 'teameklavya.xyz') {
        set.add(`${url.protocol}//www.teameklavya.xyz`);
      } else if (host === 'www.teameklavya.xyz') {
        set.add(`${url.protocol}//teameklavya.xyz`);
      }
    } catch {}
  }
  if (process.env.NODE_ENV !== 'production') {
    set.add('http://localhost:3000');
    set.add('http://localhost:3100');
    set.add('http://127.0.0.1:3000');
  }
  return Array.from(set);
}

const rawOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = expandOrigins(rawOrigins);

console.log(`[cors] Allowed origins: ${allowedOrigins.join(', ')} (trust proxy=${trustProxyValue})`);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn(`[cors] Blocked origin: ${origin} not in ${allowedOrigins.join(',')}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key', 'X-Idempotency-Key'],
  exposedHeaders: ['Retry-After', 'X-RateLimit-Reset', 'X-RateLimit-Limit'],
};

app.use(cors(corsOptions));
// Explicit preflight for Express 5 (path-to-regexp v6 requires named wildcards or regex)
app.options(/.*/, cors(corsOptions));

// ────────────────────────────────────────────────────────────
// 🛡️ Security headers
// ────────────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

// ────────────────────────────────────────────────────────────
// 🩺 Request context + compression
// ────────────────────────────────────────────────────────────
app.use(require('./middleware/request-context').requestContext);

let compression = null;
try {
  compression = require('compression');
} catch (_err) {
  console.warn('[boot] compression not installed — serving uncompressed. Run: npm i');
}
if (compression) {
  app.use(compression({ filter: (req, res) => (req.path.startsWith('/uploads') ? false : compression.filter(req, res)) }));
}

// ────────────────────────────────────────────────────────────
// 🚦 Rate limiting (after CORS so 429 has CORS headers)
// ────────────────────────────────────────────────────────────
const { applyGlobalRateLimits } = require('./config/rate-limits');
applyGlobalRateLimits(app);

// ────────────────────────────────────────────────────────────
// 🗄️ HTTP cache policy
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/uploads', express.static(uploadsDir));
if (path.resolve(uploadsDir) !== path.resolve(__dirname, 'uploads')) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// Cookie session for the Google OAuth passport flow
app.use(
  cookieSession({
    name: 'session',
    keys: [process.env.JWT_SECRET],
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
);

app.use(passport.initialize());

// ────────────────────────────────────────────────────────────
// 📦 Routes
// ────────────────────────────────────────────────────────────
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/stories', require('./routes/story.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth', require('./routes/google.routes'));
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/cron', require('./routes/cron.routes'));
app.use('/api/analytics', require('./routes/analytics.routes'));
app.use('/api/home', require('./routes/home.routes'));
app.use('/api/registration', require('./routes/registration.routes'));
app.use('/api/tickets', require('./routes/ticket.routes'));
app.use('/api/posts', require('./routes/post.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));
app.use('/api/messages', require('./routes/message.routes'));
app.use('/api/quizzes', require('./routes/quiz.routes'));
app.use('/api/follow', require('./routes/follow.routes'));
app.use('/api/organizations', require('./routes/organization.routes'));
app.use('/api/organization-registration-requests', require('./routes/organization-registration.routes'));
app.use('/api/communities', require('./routes/community.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/blocks', require('./routes/block.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/moderation', require('./routes/moderation.routes'));
app.use('/api/onboarding', require('./routes/onboarding.routes'));
app.use('/api', require('./routes/trust-safety.routes'));
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
  res.json({
    status: 'OK',
    service: 'eventhub-api',
    timestamp: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'degraded',
  });
});

// ────────────────────────────────────────────────────────────
// 🪄 Error handling — normalized taxonomy
// CORS headers are already set because CORS middleware runs before rate limiters
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
  res.status(404).json({
    success: false,
    message: 'Route not found',
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
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
// 🚀 Start Server — port binds immediately for Render health check,
// DB init runs after binding (Priority 4 fix: was blocking port binding)
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const http = require('http');
const { Server } = require('socket.io');
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
});
require('./services/realtime.service').init(io);

// Bind port immediately so Render detects open port
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ EventHub API running on port ${PORT} (DB init in background)`);
  // Start schedulers (they handle DB not ready gracefully)
  try {
    require('./services/reminder.service').startReminderScheduler();
    require('./services/enforcement-expiry.service').startEnforcementExpiryScheduler();
    require('./services/weekly-digest.service').startWeeklyDigestScheduler();
  } catch (e) {
    console.warn('[boot] scheduler start failed:', e.message);
  }

  // Initialize DB + migrations after port binding — avoids Render port scan timeout
  // Previously connectDB() was awaited before listen, causing timeout + "[asia-indexes] No DB connection, skipping"
  try {
    await initializeDatabase();
  } catch (e) {
    console.error('[boot] Database initialization failed:', e.message);
  }
});
