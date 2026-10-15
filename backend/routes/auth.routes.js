const express = require('express');
const { body } = require('express-validator');
const authCtrl = require('../controllers/auth.controller');
const { requireAuth, optionalUser } = require('../middleware/auth.middleware');
const { checkIpRestriction } = require('../middleware/ip-restriction.middleware');
const { limiters } = require('../config/rate-limits');

const router = express.Router();

// IP restriction check for auth routes (after CORS, before rate limiting in route)
router.use(checkIpRestriction);

// Signup — strict per IP brute-force protection (15/15m)
router.post('/signup', limiters.authLogin, [
  body('firstName').isLength({ min: 1 }).trim().escape(),
  body('lastName').isLength({ min: 1 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isStrongPassword({ minLength: 8, minUppercase: 1, minLowercase: 1, minNumbers: 1 }),
  body('confirmPassword').exists(),
  body('acceptTerms').isBoolean(),
], authCtrl.signup);

// Email verify (GET with token — standard verification-link pattern)
router.get('/verify-email', authCtrl.verifyEmail);

// Login — strict per IP (15/15m) to prevent brute force, but generous enough for legitimate retries
router.post('/login', limiters.authLogin, [
  body('email').isEmail().normalizeEmail(),
  body('password').exists(),
], authCtrl.login);

// Password reset flows — very strict (5/15m) to prevent abuse
router.post('/resend-verification', limiters.authPassword, [body('email').isEmail().normalizeEmail()], authCtrl.resendVerification);
router.post('/password/forgot', limiters.authPassword, [body('email').isEmail().normalizeEmail()], authCtrl.requestPasswordReset);
router.post('/password/verify-otp', limiters.authPassword, authCtrl.verifyResetOtp);
router.post('/password/reset', limiters.authPassword, authCtrl.resetPassword);

// Profile routes (protected) — generous per-user limit (120/min) for dashboard polling
router.get('/me', limiters.authMe, requireAuth, authCtrl.getProfile);
router.put('/me/profile', limiters.authMe, requireAuth, authCtrl.updateProfile);
// Public: the signup/edit form checks availability while typing.
router.get('/username-availability', limiters.authMe, optionalUser, authCtrl.checkUsername);

module.exports = router;
