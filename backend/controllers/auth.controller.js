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
    /* `_id` is the canonical key — /auth/me and every other endpoint return
       it, and the frontend compares against it to decide ownership (sent vs
       received messages, post authorship, follow state). Returning only `id`
       here meant the stored session user had no `_id` at all, so every one of
       those comparisons silently evaluated false.
       `id` is kept for any existing client that already depends on it. */
    return res.json({
      token,
      user: {
        _id: user._id,
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
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
    
    /* Part 8 §56 — the client propagates identity (header, nav avatar, post
       author, mentions) from this payload, so it carries the full canonical
       shape: `_id` plus every field the profile editor can write. Returning
       only part of it forced a second fetch and let the nav avatar go stale
       after an edit. */
    return res.json({ 
      success: true,
      user: {
        _id: user._id,
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        role: user.role,
        verified: user.verified,
        profile: user.profile,
        socialSettings: user.socialSettings,
        emailVerified: user.emailVerified
      }
    });
  } catch (err) {
    console.error("❌ getProfile error:", err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/* ── Profile update ───────────────────────────────────────────────────────
 * Writes are an EXPLICIT ALLOWLIST. Never spread req.body onto the document:
 * User carries `role` and `points`, so a blind spread is a privilege
 * escalation and a self-serve points mint in one line.
 *
 * The previous implementation accepted only institution/course/year, so the
 * avatar, cover, username, display name, bio, location, interests and privacy
 * settings the UI sends were all discarded — silently, with a 200 OK. Every
 * one of those fields already exists on the User schema; they simply had no
 * write path. */
const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const BIO_MAX = 280;
const NAME_MAX = 50;
const LOCATION_MAX = 80;
const WEBSITE_MAX = 200;
const INTERESTS_MAX = 10;
const URL_MAX = 500;

/** Accepts only http(s) URLs, or '' to clear. Rejects javascript:, data:, etc. */
function sanitizeUrl(value) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > URL_MAX) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

exports.updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.profile) user.profile = {};
    if (!user.socialSettings) user.socialSettings = {};

    const b = req.body || {};
    const fail = (message) => res.status(400).json({ message });

    // ── Identity ────────────────────────────────────────────────────────
    if (b.firstName !== undefined) {
      if (typeof b.firstName !== 'string' || !b.firstName.trim()) return fail('First name is required');
      if (b.firstName.trim().length > NAME_MAX) return fail(`First name must be ${NAME_MAX} characters or fewer`);
      user.firstName = b.firstName.trim();
    }
    if (b.lastName !== undefined) {
      if (typeof b.lastName !== 'string') return fail('Last name must be a string');
      if (b.lastName.trim().length > NAME_MAX) return fail(`Last name must be ${NAME_MAX} characters or fewer`);
      user.lastName = b.lastName.trim();
    }

    // ── Username: validated + uniqueness-checked against other users ────
    if (b.username !== undefined) {
      const username = String(b.username || '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) {
        return fail('Username must be 3-30 characters: letters, numbers and underscore only');
      }
      const taken = await User.findOne({ username, _id: { $ne: user._id } }).select('_id').lean();
      if (taken) return res.status(409).json({ message: 'That username is already taken', field: 'username' });
      user.username = username;
    }

    // ── Profile sub-document ────────────────────────────────────────────
    if (b.avatar !== undefined) {
      const avatar = sanitizeUrl(b.avatar);
      if (avatar === null) return fail('Profile photo must be a valid http(s) URL');
      user.profile.avatar = avatar;
    }
    /* Cover focal point (§7 — "repositionable"). Clamped rather than
     * rejected: an out-of-range number is a client bug, and clamping keeps
     * the banner visible instead of failing the whole save.
     *
     * Evaluated BEFORE coverImage, deliberately. The edit sheet can send both
     * in one request — the user drags the crop, then removes the banner — and
     * the focal point belongs to the image being removed. Applying it after
     * the removal would store a crop for a photo that no longer exists, which
     * then silently applies to the NEXT upload. */
    if (b.coverPosition !== undefined) {
      const pos = Number(b.coverPosition);
      if (!Number.isFinite(pos)) return fail('Cover position must be a number');
      user.profile.coverPosition = Math.min(100, Math.max(0, Math.round(pos)));
    }
    if (b.coverImage !== undefined) {
      const cover = sanitizeUrl(b.coverImage);
      if (cover === null) return fail('Cover image must be a valid http(s) URL');
      user.profile.coverImage = cover;
      // Removing the banner resets its focal point, so a later upload starts
      // clean instead of inheriting the previous photo's crop.
      if (!cover) user.profile.coverPosition = 50;
    }
    if (b.bio !== undefined) {
      if (typeof b.bio !== 'string') return fail('Bio must be a string');
      if (b.bio.length > BIO_MAX) return fail(`Bio must be ${BIO_MAX} characters or fewer`);
      user.profile.bio = b.bio;
    }
    if (b.location !== undefined) {
      if (typeof b.location !== 'string') return fail('Location must be a string');
      if (b.location.length > LOCATION_MAX) return fail(`Location must be ${LOCATION_MAX} characters or fewer`);
      user.profile.location = b.location;
    }
    if (b.website !== undefined) {
      if (typeof b.website !== 'string') return fail('Website must be a string');
      if (b.website.length > WEBSITE_MAX) return fail(`Website must be ${WEBSITE_MAX} characters or fewer`);
      /* Normalised through the same sanitizer as the media URLs: a profile
       * link is rendered as a clickable href, so `javascript:` must not
       * survive. Empty string stays valid — it is how a link is removed. */
      const site = sanitizeUrl(b.website);
      if (site === null) return fail('Website must be a valid http(s) URL');
      user.profile.website = site;
    }
    if (b.interests !== undefined) {
      if (!Array.isArray(b.interests)) return fail('Interests must be an array');
      const cleaned = [
        ...new Set(
          b.interests
            .filter((i) => typeof i === 'string')
            .map((i) => i.trim().toLowerCase())
            .filter(Boolean)
        ),
      ].slice(0, INTERESTS_MAX);
      if (cleaned.length > INTERESTS_MAX) return fail(`You can add up to ${INTERESTS_MAX} interests`);
      user.profile.interests = cleaned;
    }
    if (b.institution !== undefined) {
      if (typeof b.institution !== 'string') return fail('Institution must be a string');
      user.profile.institution = b.institution;
    }
    if (b.course !== undefined) {
      if (typeof b.course !== 'string') return fail('Course must be a string');
      user.profile.course = b.course;
    }
    if (b.year !== undefined) {
      if (typeof b.year !== 'string') return fail('Year must be a string');
      user.profile.year = b.year;
    }

    // ── Privacy / notification settings (enum-guarded) ──────────────────
    if (b.profileVisibility !== undefined) {
      if (!['public', 'followers', 'private'].includes(b.profileVisibility)) return fail('Invalid profile visibility');
      user.socialSettings.profileVisibility = b.profileVisibility;
    }
    if (b.allowMessagesFrom !== undefined) {
      if (!['everyone', 'followers', 'nobody'].includes(b.allowMessagesFrom)) return fail('Invalid messaging preference');
      user.socialSettings.allowMessagesFrom = b.allowMessagesFrom;
    }
    if (b.showAttendance !== undefined) user.socialSettings.showAttendance = Boolean(b.showAttendance);
    if (b.showAchievements !== undefined) user.socialSettings.showAchievements = Boolean(b.showAchievements);

    await user.save();

    /* Return the full updated user, not just `profile`. The client needs to
       propagate the new identity into the header, nav avatar, post author
       labels and cached profile in one pass (Part 8 §56) — returning only the
       sub-document forces a second round-trip and a reload. */
    return res.json({
      success: true,
      message: 'Profile updated',
      user: {
        _id: user._id,
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        verified: user.verified,
        profile: user.profile,
        socialSettings: user.socialSettings,
      },
    });
  } catch (err) {
    // Unique-index collision on username races a concurrent update.
    if (err && err.code === 11000) {
      return res.status(409).json({ message: 'That username is already taken', field: 'username' });
    }
    console.error('updateProfile error:', (err && err.message) || err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/auth/username-availability?username=foo — public, debounced by the client. */
exports.checkUsername = async (req, res) => {
  try {
    const username = String(req.query.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ message: 'Username required' });
    if (!USERNAME_RE.test(username)) {
      return res.json({ available: false, reason: 'invalid', message: '3-30 characters: letters, numbers, underscore' });
    }
    const me = req.user?.id;
    const existing = await User.findOne(
      me ? { username, _id: { $ne: me } } : { username }
    )
      .select('_id')
      .lean();
    if (existing) return res.json({ available: false, reason: 'taken', message: 'That username is already taken' });
    return res.json({ available: true });
  } catch (err) {
    console.error('checkUsername error:', (err && err.message) || err);
    return res.status(500).json({ message: 'Server error' });
  }
};