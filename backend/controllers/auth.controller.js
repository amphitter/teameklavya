const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const emailService = require('../services/email.service');
const templates = require('../services/emailTemplates');
const { generateToken, generateOTP } = require('../utils/crypto');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

function signJwt(user) {
  return jwt.sign({ id: user._id, role: user.role, email: user.email, purpose: 'auth' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

exports.signup = async (req, res) => {
  // expected: firstName,lastName,email,password,confirmPassword,acceptTerms(boolean)
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { firstName, lastName, email, password, confirmPassword, acceptTerms } = req.body;
    if (!acceptTerms) return res.status(400).json({ message: 'You must accept terms & privacy' });
    if (password !== confirmPassword) return res.status(400).json({ message: 'Passwords do not match' });

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // create email verification token
    const verifyToken = generateToken(18);
    const verifyExpires = new Date(Date.now() + 24 * 3600 * 1000); // 24h

    const user = await User.create({
      firstName, lastName, email, passwordHash,
      emailVerifyToken: verifyToken,
      emailVerifyExpires: verifyExpires
    });

    /* The account already exists by this point — User.create() succeeded above.
       If a mail failure threw here, the user would get a 500, assume signup
       failed, and retry straight into "Email already registered". They would
       be left with an unverified account they cannot use and, with no resend
       endpoint, cannot recover.
       So delivery is reported, not fatal. The response tells the client
       whether the mail went out, which is safe here — the user just created
       this account themselves, so there is nothing to enumerate. */
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}&email=${encodeURIComponent(email)}`;

    let emailSent = true;
    try {
      const sent = await exports.sendVerificationEmail(user, verifyUrl);
      // No provider configured is not an exception — it resolves as skipped.
      if (sent && sent.skipped) emailSent = false;
    } catch (err) {
      emailSent = false;
      console.error(
        `[signup] verification email FAILED for ${user.email}: ${(err && err.message) || err}`
      );
    }

    return res.status(201).json({
      message: emailSent
        ? 'User registered. Please verify your email.'
        : 'Account created, but we could not send the verification email. Use "Resend verification" to try again.',
      emailSent,
      canResendVerification: true,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
// Send the signup verification email
exports.sendVerificationEmail = async (user, verifyUrl) => {
  const { html, text } = templates.verifyEmail({ user, verifyUrl });
  /* Returned rather than discarded: with no provider configured, send()
     resolves with { provider: "none", skipped: true } instead of throwing.
     Callers that only check for a rejection would report "sent" for an email
     that never left the process. */
  const result = await emailService.send({
    to: user.email,
    subject: "Verify your EventHub email",
    html,
    text,
  });
  if (result && result.skipped) {
    console.warn(
      `[signup] verification email NOT SENT for ${user.email} — no email provider configured`
    );
  } else {
    console.log(`Verification email sent to ${user.email}`);
  }
  return result;
};

/**
 * Resend the verification email.
 *
 * Without this, a delivery failure at signup strands the account permanently:
 * it exists, it is unverified, login refuses it, and there is no other path to
 * a verification link. The user is locked out of their own email address for
 * good.
 *
 * The response is identical whether or not the address exists — otherwise this
 * becomes a cleaner enumeration oracle than signup ever was.
 */
exports.resendVerification = async (req, res) => {
  const GENERIC = 'If that address needs verification, a new link has been sent.';
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ message: 'Email required' });

    const user = await User.findOne({ email });
    if (!user) return res.json({ message: GENERIC });
    if (user.emailVerified) return res.json({ message: GENERIC });

    // Rotate the token: the old one may have been the thing that never arrived.
    user.emailVerifyToken = generateToken(18);
    user.emailVerifyExpires = new Date(Date.now() + 24 * 3600 * 1000);
    await user.save();

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${user.emailVerifyToken}&email=${encodeURIComponent(email)}`;

    await exports.sendVerificationEmail(user, verifyUrl);
    return res.json({ message: GENERIC });
  } catch (err) {
    /* A mail outage is not an internal error — that is a provider failure the
       user did not cause and cannot fix. Log it, and answer with the same
       generic response so an outage cannot be used to probe for accounts. */
    console.error('[resend-verification] failed:', (err && err.message) || err);
    return res.json({ message: GENERIC });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { token, email } = req.query;
    if (!token || !email) return res.status(400).send('Missing token or email');

    const user = await User.findOne({ email, emailVerifyToken: token });
    if (!user) return res.status(400).send('Invalid token or email');
    if (user.emailVerifyExpires < Date.now()) return res.status(400).send('Token expired');

    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();

    // Redirect to frontend success page or return JSON
    return res.redirect(`${process.env.FRONTEND_URL}/verify-success`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    // if password not set (oauth user) ask to login with provider or set password
    if (!user.passwordHash) return res.status(403).json({ message: 'No local password set. Login with OAuth provider or set password.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    if (!user.emailVerified) {
      // optional: enforce email verification before allowing full login
      return res.status(403).json({ message: 'Please verify your email before logging in.' });
    }

    // Moderation (Part 3, Phase 10): suspended accounts can't log in
    if (user.suspendedAt) {
      return res.status(403).json({
        suspended: true,
        message: user.suspensionReason
          ? `Your account has been suspended: ${user.suspensionReason}`
          : 'Your account has been suspended.',
      });
    }

    const token = signJwt(user);
    return res.json({ token, user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Forgot password -> generate OTP and send email (or send reset link)
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ message: 'If the email exists, an OTP has been sent.' }); // don't reveal existence

    const otp = generateOTP(6);
    user.resetOtp = otp;
    user.resetOtpExpires = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await user.save();

    /* Deliberately NOT awaited.
       Two reasons, and the first is a security one:
       1. If a mail failure produced a 500 here, the endpoint would leak
          whether the account exists — 200 for "no such user" above, 500 for
          "user exists but mail is down". That turns the anti-enumeration
          measure on the line above into an enumeration oracle. The response
          MUST be identical either way.
       2. The provider timeout is ~25s. Awaiting it means the user stares at a
          spinner for 26 seconds and then gets an error, for a problem that is
          not theirs and that they cannot fix.
       This is fire-and-forget done correctly: the outcome cannot change the
       response, so not awaiting loses nothing — but the rejection is handled
       explicitly so a failed send is logged instead of vanishing. */
    exports.sendResetOtpEmail(user, otp, OTP_TTL_MINUTES).catch((err) => {
      console.error(
        `[password-reset] OTP email FAILED for ${user.email}: ${(err && err.message) || err}`
      );
    });

    return res.json({ message: 'If the email exists, an OTP has been sent.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
// Send the password-reset OTP email
exports.sendResetOtpEmail = async (user, otp, ttlMinutes) => {
  const { html, text } = templates.passwordResetOtp({ user, otp, ttlMinutes });
  await emailService.send({
    to: user.email,
    subject: "Your EventHub password reset code",
    html,
    text,
  });
  console.log(`Password reset OTP email sent to ${user.email}`);
};

exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

    const user = await User.findOne({ email, resetOtp: otp });
    if (!user) return res.status(400).json({ message: 'Invalid OTP' });
    if (user.resetOtpExpires < Date.now()) return res.status(400).json({ message: 'OTP expired' });

    // success — return a temporary token to allow password reset (or allow reset directly)
    const tempToken = generateToken(18);
    // we can store temp token for short time or just allow direct reset; for simplicity, respond with a temp token
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    user.passwordResetToken = tempToken;
    user.passwordResetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15m
    await user.save();

    return res.json({ tempToken, message: 'OTP verified. Use tempToken to set new password.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, tempToken, newPassword, confirmPassword } = req.body;
    
    console.log("🔐 Reset password request:", { 
      email, 
      tempToken: tempToken ? "present" : "missing",
      newPasswordLength: newPassword?.length 
    });

    if (!email || !tempToken || !newPassword) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match' });
    }

    // Find user by email and tempToken (passwordResetToken)
    const user = await User.findOne({ 
      email, 
      passwordResetToken: tempToken 
    });
    
    console.log("🔐 User found for reset:", user ? user.email : "none");

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    if (user.passwordResetTokenExpires < Date.now()) {
      return res.status(400).json({ message: 'Token has expired' });
    }

    console.log("🔐 Token validation successful for:", user.email);

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    
    // Clear reset tokens
    user.passwordResetToken = undefined;
    user.passwordResetTokenExpires = undefined;
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    
    await user.save();

    console.log("🔐 Password reset successful for:", user.email);

    return res.json({ 
      success: true,
      message: 'Password updated successfully' 
    });
  } catch (err) {
    console.error("❌ Reset password error:", err);
    return res.status(500).json({ message: 'Server error during password reset' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    console.log("🔐 getProfile - User ID:", req.user.id); // Add this for debugging
    const user = await User.findById(req.user.id).select('-passwordHash -resetOtp -passwordResetToken');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    return res.json({ 
      success: true,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        profile: user.profile,
        emailVerified: user.emailVerified
      }
    });
  } catch (err) {
    console.error("❌ getProfile error:", err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { institution, course, year } = req.body;
    console.log("🔐 updateProfile - User ID:", req.user.id); // Add this for debugging
    
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Initialize profile if it doesn't exist
    if (!user.profile) {
      user.profile = {};
    }

    user.profile.institution = institution ?? user.profile.institution;
    user.profile.course = course ?? user.profile.course;
    user.profile.year = year ?? user.profile.year;
    
    await user.save();
    
    return res.json({ 
      success: true,
      message: 'Profile updated', 
      profile: user.profile 
    });
  } catch (err) {
    console.error("❌ updateProfile error:", err);
    return res.status(500).json({ message: 'Server error' });
  }
};