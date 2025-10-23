const express = require('express');
const { body } = require('express-validator');
const authCtrl = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Signup
router.post('/signup', [
  body('firstName').isLength({ min: 1 }),
  body('lastName').isLength({ min: 1 }),
  body('email').isEmail(),
  body('password').isStrongPassword({ minLength: 8, minUppercase: 1, minLowercase: 1, minNumbers: 1 }),
  body('confirmPassword').exists(),
  body('acceptTerms').isBoolean()
], authCtrl.signup);

// Email verify (GET)
router.get('/verify-email', authCtrl.verifyEmail);

// Login
router.post('/login', [
  body('email').isEmail(),
  body('password').exists()
], authCtrl.login);

// Password reset flows
router.post('/password/forgot', [ body('email').isEmail() ], authCtrl.requestPasswordReset);
router.post('/password/verify-otp', authCtrl.verifyResetOtp);
router.post('/password/reset', authCtrl.resetPassword);

// Profile routes (protected)
router.get('/me', requireAuth, authCtrl.getProfile);
router.put('/me/profile', requireAuth, authCtrl.updateProfile);
router.get('/profile', requireAuth, authCtrl.getProfile);
router.put('/profile', requireAuth, authCtrl.updateProfile);

module.exports = router;

