const express = require('express');
const passport = require('passport');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

// Start Google OAuth flow
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

// Google OAuth callback.
// SECURITY: we never put a long-lived session token in the URL.
// Instead we issue a SHORT-LIVED (2 min) one-time exchange code, which the
// frontend immediately exchanges for a real token via an authenticated POST.
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/google/fail', session: false }),
  (req, res) => {
    const code = jwt.sign(
      { purpose: 'oauth_code', id: req.user._id, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2m' }
    );
    const redirectUrl = `${process.env.FRONTEND_URL}/oauth-callback?code=${code}`;
    res.redirect(redirectUrl);
  }
);

// Exchange the short-lived OAuth code for a real session token (POST body only).
router.post('/google/exchange', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ success: false, message: 'code is required' });
    }

    const decoded = jwt.verify(code, process.env.JWT_SECRET);
    if (decoded.purpose !== 'oauth_code') {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    // Moderation (Part 3, Phase 10): suspended accounts can't get a session
    if (user.suspendedAt) {
      return res.status(403).json({
        success: false,
        suspended: true,
        message: user.suspensionReason
          ? `Your account has been suspended: ${user.suspensionReason}`
          : 'Your account has been suspended.',
      });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, purpose: 'auth' },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    const message = error.name === 'TokenExpiredError'
      ? 'Login code expired — please try again'
      : 'Invalid login code';
    return res.status(400).json({ success: false, message });
  }
});

router.get('/google/fail', (req, res) => {
  res.status(401).json({ success: false, message: 'Google authentication failed' });
});

module.exports = router;
