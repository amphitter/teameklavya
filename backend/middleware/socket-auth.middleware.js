/**
 * Socket.IO authentication middleware — Trust & Safety hardened.
 * Identity is ALWAYS derived from the JWT in the handshake.
 * Suspended/banned accounts blocked, tokenVersion revocation enforced.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

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

    const user = await User.findById(decoded.id).select("suspendedAt suspensionExpiresAt bannedAt banReason tokenVersion").lean();
    if (!user) {
      return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Account no longer exists" })));
    }
    if (user.bannedAt) {
      return next(new Error(JSON.stringify({ code: "NOT_AUTHORIZED", message: user.banReason ? `Banned: ${user.banReason}` : "Account banned" })));
    }
    if (user.suspendedAt) {
      if (user.suspensionExpiresAt && new Date(user.suspensionExpiresAt).getTime() < Date.now()) {
        // expired suspension - allow, cleanup job will clear
      } else {
        return next(new Error(JSON.stringify({ code: "NOT_AUTHORIZED", message: "Your account has been suspended" })));
      }
    }
    if (decoded.tokenVersion !== undefined && user.tokenVersion !== undefined) {
      if (decoded.tokenVersion !== user.tokenVersion) {
        return next(new Error(JSON.stringify({ code: "AUTH_FAILED", message: "Session revoked" })));
      }
    }

    socket.data.user = { id: String(decoded.id), tokenVersion: decoded.tokenVersion };
    next();
  } catch (error) {
    next(new Error(JSON.stringify({ code: "INTERNAL", message: "Authentication check failed" })));
  }
}

module.exports = { socketAuth };
