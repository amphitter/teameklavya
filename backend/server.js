// Load environment variables early
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const passport = require('./config/passport');
const cookieSession = require('cookie-session');

// DB Connection
const connectDB = require('./config/db');
connectDB();

// Initialize Express
const app = express();

// ------------------------------------------------------------
// 🧰 Middleware Setup
// ------------------------------------------------------------

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/tickets/static', express.static(path.join(__dirname, 'tickets')));

// Cookie session for authentication
app.use(cookieSession({
  name: 'session',
  keys: [process.env.JWT_SECRET || 'keyboardcat'],
  maxAge: 24 * 60 * 60 * 1000, // 1 day
}));

// Initialize Passport
app.use(passport.initialize());

// ------------------------------------------------------------
// 📦 Routes
// ------------------------------------------------------------
app.use('/api/upload', require('./routes/upload.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/auth', require('./routes/google.routes'));
app.use('/api/events', require('./routes/event.routes'));
app.use('/api/registration', require('./routes/registration.routes'));
app.use('/api/tickets', require('./routes/ticket.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/user', require('./routes/user.routes'));

// ------------------------------------------------------------
// 🧭 Health Check
// ------------------------------------------------------------
app.get('/', (req, res) => {
  res.send('🚀 Team Eklavya Backend is running!');
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ------------------------------------------------------------
// 🪄 Error Handling
// ------------------------------------------------------------

// Generic error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    success: false,
    message: error.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ------------------------------------------------------------
// 📁 Ensure required directories exist
// ------------------------------------------------------------
const requiredDirs = ['tickets', 'uploads'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📂 Created missing directory: ${dir}`);
  }
});

// ------------------------------------------------------------
// 🚀 Start Server
// ------------------------------------------------------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on: http://localhost:${PORT}`);
  console.log(`🌐 Accessible on LAN at: http://YOUR_LOCAL_IP:${PORT}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, 'uploads')}`);
});
