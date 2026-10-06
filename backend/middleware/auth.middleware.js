const jwt = require("jsonwebtoken");
const User = require("../models/user.model");

/*
 * PERMANENT SUPER ADMIN (Ownership Verification system)
 * This account always has full platform-level control. It can never be
 * removed, demoted or transferred, and it bypasses every role check.
 *
 * Part 7 §10: the address and the rule now live in services/ownership.service
 * and are RE-EXPORTED from here. Five modules used to re-derive the address by
 * hand; they agreed by coincidence, and the first one to be edited would have
 * become either a hole or a lockout. Import from this module as before — the
 * surface is unchanged — but there is now one definition underneath it.
 */
const ownership = require("../services/ownership.service");

const SUPER_ADMIN_EMAIL = ownership.SUPER_ADMIN_EMAIL;
const isSuperAdminEmail = ownership.isSuperAdminEmail;

exports.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
exports.isSuperAdminEmail = isSuperAdminEmail;
exports.ownership = ownership;

/** True if the given request user (id) is the permanent super admin. */
exports.isSuperAdmin = async (user) => {
  if (!user?.id) return false;
  const dbUser = await User.findById(user.id).select("email").lean();
  return Boolean(dbUser && isSuperAdminEmail(dbUser.email));
};

/**
 * Require a valid Bearer JWT (purpose: auth).
 * Short-lived OAuth exchange codes are rejected here.
 */
exports.requireAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject short-lived OAuth exchange codes being used as session tokens
    if (decoded.purpose && decoded.purpose !== "auth") {
      return res.status(401).json({ success: false, message: "Invalid token type" });
    }

    // Moderation (Part 3, Phase 10): suspended accounts are blocked from ALL
    // authenticated actions server-side — an existing token is not a bypass.
    const live = await User.findById(decoded.id).select("suspendedAt suspensionReason").lean();
    if (live?.suspendedAt) {
      return res.status(403).json({
        success: false,
        suspended: true,
        message: live.suspensionReason
          ? `Your account has been suspended: ${live.suspensionReason}`
          : "Your account has been suspended.",
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    const message =
      error.name === "TokenExpiredError" ? "Session expired, please log in again" : "Invalid token";
    res.status(401).json({ success: false, message });
  }
};

/**
 * Require an authenticated admin user (server-side role check).
 * The browser is never a security boundary — roles are always verified here.
 */
exports.requireAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    // The permanent super admin always has full platform-level control
    if ((!user || user.role !== "admin") && !isSuperAdminEmail(user?.email)) {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: "Authorization check failed" });
  }
};

/**
 * Attach req.user if a valid token is present; never reject the request.
 * Used by public endpoints that behave differently for organizers
 * (e.g. private event pages).
 */
exports.optionalUser = async (req, _res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return next();
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.purpose && decoded.purpose !== "auth") return next();
    req.user = decoded;
  } catch (_error) {
    // Invalid/expired token on a public route → continue anonymously
  }
  next();
};

/**
 * True if the request user is an admin or the creator of the given event.
 */
exports.canManageEvent = async (user, event) => {
  if (!user) return false;
  const dbUser = await User.findById(user.id);
  if (dbUser?.role === "admin") return true;
  return String(event.createdBy) === String(user.id);
};

/**
 * Require the permanent Super Admin (Ownership Verification system).
 * Nobody else — not even platform admins — passes this check.
 */
exports.requireSuperAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("email").lean();
    if (!user || !isSuperAdminEmail(user.email)) {
      return res.status(403).json({ success: false, message: "Super Admin access required" });
    }
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: "Authorization check failed" });
  }
};
