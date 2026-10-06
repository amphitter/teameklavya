/**
 * Socket.IO authentication middleware (Part 4, Phase 2 — spec §80).
 * Identity is ALWAYS derived from the JWT in the handshake — a client-sent
 * userId is never trusted. Suspended accounts are blocked here too,
 * consistent with the HTTP requireAuth middleware (Part 3, Phase 10).
 */
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

/**
 * Wire with: io.use(socketAuth).
 * Expects handshake auth: { token: "<jwt>" }.
 * On success: socket.data.user = { id }. On failure: structured error + disconnect.
 */
async function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Authentication required" })));
    }
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_err) {
      return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Invalid or expired token" })));
    }
    if (decoded.purpose && decoded.purpose !== "auth") {
      return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Invalid token type" })));
    }

    const user = await User.findById(decoded.id).select("suspendedAt").lean();
    if (!user) {
      return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Account no longer exists" })));
    }
    if (user.suspendedAt) {
      return next(new Error(JSON.stringify({ code: "NOT_AUTHORIZED", message: "Your account has been suspended" })));
    }

    socket.data.user = { id: String(decoded.id) };
    next();
  } catch (error) {
    next(new Error(JSON.stringify({ code: "INTERNAL", message: "Authentication check failed" })));
  }
}

module.exports = { socketAuth };
