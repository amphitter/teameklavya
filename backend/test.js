const jwt = require('jsonwebtoken');

// User ID and role from your DB
const payload = {
  id: "68e273eace1ec5ef53fdd6fa",
  role: "user"
};

// Your secret from .env
const secret = "nLMrwPf4aq4DHYE1eFInrTEcNhGtcC1k";

// Optional: set token expiry
const options = { expiresIn: '7d' };

// Generate token
const token = jwt.sign(payload, secret, options);

console.log("Your JWT token:\n", token);
