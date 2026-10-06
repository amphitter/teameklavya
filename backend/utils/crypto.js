const crypto = require('crypto');

/**
 * Cryptographically secure random token (hex).
 */
function generateToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

/**
 * Cryptographically secure numeric OTP.
 * Uses crypto.randomInt (CSPRNG) — never Math.random.
 */
function generateOTP(length = 6) {
  const max = 10 ** length;
  return String(crypto.randomInt(0, max)).padStart(length, '0');
}

module.exports = { generateToken, generateOTP };
