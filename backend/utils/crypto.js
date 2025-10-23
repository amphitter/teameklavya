const crypto = require('crypto');

function generateToken(len = 32) {
  return crypto.randomBytes(len).toString('hex');
}

function generateOTP(length = 6) {
  // numeric OTP
  let otp = '';
  for (let i = 0; i < length; i++) otp += Math.floor(Math.random() * 10);
  return otp;
}
module.exports = { generateToken, generateOTP };