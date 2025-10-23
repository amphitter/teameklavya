const express = require('express');
const passport = require('passport');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Initialize passport in server.js and require './config/passport'

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/auth/google/fail', session: false }), (req, res) => {
  // user is in req.user
  const token = jwt.sign({ id: req.user._id, role: req.user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

  // Option A: redirect to frontend with token
  const redirectUrl = `${process.env.FRONTEND_URL}/oauth-callback?token=${token}`;
  res.redirect(redirectUrl);
});

router.get('/google/fail', (req, res) => {
  res.status(401).send('Google auth failed');
});

module.exports = router;
