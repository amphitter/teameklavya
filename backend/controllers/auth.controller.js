const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const { sendEmail } = require('../utils/email');
const { generateToken, generateOTP } = require('../utils/crypto');

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);

function signJwt(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
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

    // send verification email
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}&email=${encodeURIComponent(email)}`;
    await this.sendVerificationEmail(user, verifyUrl);
    return res.status(201).json({ message: 'User registered. Please verify your email.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
exports.sendVerificationEmail = async (user, verifyUrl) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify Your Email - Team Eklavya</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Inter',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Verify your Team Eklavya account to complete registration.
  </div>

  <div style="width:100%;padding:0;background-color:#f5f7fa;">
    <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.05);overflow:hidden;">
      
      <div style="background:#004aad;padding:20px 30px;text-align:center;">
        <img src="https://i.ibb.co/ZzYmZNxQ/24.png" alt="Team Eklavya Logo" style="max-height:55px;margin-bottom:10px;" />
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">Verify Your Email</h1>
      </div>

      <div style="padding:30px;">
        <h2 style="color:#004aad;margin-bottom:10px;">Hey ${user.firstName} ${user.lastName},</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;margin-bottom:25px;">
          Thanks for signing up with <strong>Team Eklavya</strong>!<br/>
          Please confirm your email address to activate your account.
        </p>

        <div style="text-align:center;margin:30px 0;">
          <a href="${verifyUrl}" 
             style="background:#004aad;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;">
            Verify Email
          </a>
        </div>

        <p style="color:#555;font-size:13px;text-align:center;margin-bottom:0;">
          This link will expire in <strong>24 hours</strong>. If you didn’t sign up, just ignore this email.
        </p>
      </div>

      <div style="background:#f8f9fb;text-align:center;padding:20px;">
        <p style="color:#888;font-size:13px;margin-bottom:10px;">Follow us for updates</p>
        <table role="presentation" align="center" style="margin:0 auto 15px auto;">
          <tr>
            <td style="padding:0 6px;">
              <a href="https://www.instagram.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://x.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/5968/5968830.png" alt="X" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://www.linkedin.com/company/i-team-eklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" alt="LinkedIn" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="WhatsApp" width="24" height="24" />
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#888;font-size:13px;margin:0;">Team Eklavya</p>
        <p style="color:#aaa;font-size:12px;margin-top:5px;">If you have any questions, contact the event organizers.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const textContent = `
Hi ${user.firstName},

Thanks for signing up with Team Eklavya!
Please verify your email by clicking the link below:
${verifyUrl}

This link expires in 24 hours.
`;

  await sendEmail({
    to: user.email,
    subject: "Verify Your Team Eklavya Account",
    html: htmlContent,
    text: textContent,
  });

  console.log(`✅ Verification email sent to ${user.email}`);
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
    await this.sendResetOtpEmail(user, otp, OTP_TTL_MINUTES);
    return res.json({ message: 'If the email exists, an OTP has been sent.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};
exports.sendResetOtpEmail = async (user, otp, ttlMinutes) => {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset OTP - Team Eklavya</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Inter',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    Your OTP for Team Eklavya password reset.
  </div>

  <div style="width:100%;padding:0;background-color:#f5f7fa;">
    <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.05);overflow:hidden;">

      <div style="background:#004aad;padding:20px 30px;text-align:center;">
        <img src="https://i.ibb.co/ZzYmZNxQ/24.png" alt="Team Eklavya Logo" style="max-height:55px;margin-bottom:10px;" />
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">Password Reset OTP</h1>
      </div>

      <div style="padding:30px;text-align:center;">
        <h2 style="color:#004aad;margin-bottom:10px;">Hey ${user.firstName},</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;margin-bottom:25px;">
          You requested to reset your password.<br/>
          Use the OTP below to complete the process.
        </p>

        <div style="background:#f0f6ff;border-left:4px solid #004aad;padding:15px 20px;border-radius:6px;display:inline-block;margin-bottom:25px;">
          <h3 style="margin:0;color:#004aad;font-size:24px;letter-spacing:3px;">${otp}</h3>
        </div>

        <p style="color:#555;font-size:13px;margin-bottom:0;">
          This OTP expires in <strong>${ttlMinutes} minutes</strong>.<br/>
          If you didn’t request this, please ignore this email.
        </p>
      </div>

      <div style="background:#f8f9fb;text-align:center;padding:20px;">
        <p style="color:#888;font-size:13px;margin-bottom:10px;">Follow us for updates</p>
        <table role="presentation" align="center" style="margin:0 auto 15px auto;">
          <tr>
            <td style="padding:0 6px;">
              <a href="https://www.instagram.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://x.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/5968/5968830.png" alt="X" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://www.linkedin.com/company/i-team-eklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" alt="LinkedIn" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="WhatsApp" width="24" height="24" />
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#888;font-size:13px;margin:0;">Team Eklavya</p>
        <p style="color:#aaa;font-size:12px;margin-top:5px;">If you have any questions, contact the event organizers.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

  const textContent = `
Hi ${user.firstName},

Your Team Eklavya password reset OTP is: ${otp}
It expires in ${ttlMinutes} minutes.

If you didn’t request this, please ignore this email.
`;

  await sendEmail({
    to: user.email,
    subject: "Your Team Eklavya Password Reset OTP",
    html: htmlContent,
    text: textContent,
  });

  console.log(`✅ Password reset OTP email sent to ${user.email}`);
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