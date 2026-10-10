const express = require('express');
const { body } = require('express-validator');
const authCtrl = require('../controllers/auth.controller');
const { requireAuth, optionalUser } = require('../middleware/auth.middleware');
const { checkIpRestriction } = require('../middleware/ip-restriction.middleware');

const router = express.Router();

// IP restriction check for auth routes
router.use(checkIpRestriction);

// Signup
router.post('/signup', [
  body('firstName').isLength({ min: 1 }).trim().escape(),
  body('lastName').isLength({ min: 1 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isStrongPassword({ minLength: 8, minUppercase: 1, minLowercase: 1, minNumbers: 1 }),
  body('confirmPassword').exists(),
  body('acceptTerms').isBoolean(),
], authCtrl.signup);

// Email verify (GET with token — standard verification-link pattern)
router.get('/verify-email', authCtrl.verifyEmail);

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
], authCtrl.login);

// Password reset flows
router.post('/resend-verification', [body('email').isEmail().normalizeEmail()], authCtrl.resendVerification);
router.post('/password/forgot', [body('email').isEmail().normalizeEmail()], authCtrl.requestPasswordReset);
router.post('/password/verify-otp', authCtrl.verifyResetOtp);
router.post('/password/reset', authCtrl.resetPassword);

// Profile routes (protected) — single canonical pair
router.get('/me', requireAuth, authCtrl.getProfile);
router.put('/me/profile', requireAuth, authCtrl.updateProfile);
// Public: the signup/edit form checks availability while typing. Self is excluded
// when a token is supplied, so saving your own unchanged username stays valid.
router.get('/username-availability', optionalUser, authCtrl.checkUsername);

module.exports = router;
