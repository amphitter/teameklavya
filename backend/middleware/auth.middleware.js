const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const eventPermissions = require("../services/event-permissions.service");
const { ERROR_CODES } = require("../utils/app-error");

function errBody(code, message, extra = {}) {
  return { success: false, message, error: { code, message }, ...extra };
}

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
      return res.status(401).json(errBody(ERROR_CODES.AUTH_REQUIRED, "Authentication required"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Reject short-lived OAuth exchange codes being used as session tokens
    if (decoded.purpose && decoded.purpose !== "auth") {
      return res.status(401).json(errBody(ERROR_CODES.AUTH_REQUIRED, "Invalid token type"));
    }

    // Moderation (Part 3, Phase 10 + Trust & Safety): suspended/banned accounts blocked server-side
    const live = await User.findById(decoded.id)
      .select("suspendedAt suspensionReason suspensionExpiresAt bannedAt banReason tokenVersion")
      .lean();
    if (!live) {
      return res.status(401).json(errBody(ERROR_CODES.AUTH_REQUIRED, "User not found"));
    }
    if (live.bannedAt) {
      const msg = live.banReason ? `Your account has been permanently banned: ${live.banReason}` : "Your account has been permanently banned.";
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, msg, { banned: true }));
    }
    if (live.suspendedAt) {
      if (live.suspensionExpiresAt && new Date(live.suspensionExpiresAt).getTime() < Date.now()) {
        // expired suspension - allow, background job will clear
      } else {
        const msg = live.suspensionReason ? `Your account has been suspended: ${live.suspensionReason}` : "Your account has been suspended.";
        const extra = { suspended: true };
        if (live.suspensionExpiresAt) extra.expiresAt = live.suspensionExpiresAt;
        return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, msg, extra));
      }
    }
    if (decoded.tokenVersion !== undefined && live.tokenVersion !== undefined) {
      if (decoded.tokenVersion !== live.tokenVersion) {
        return res.status(401).json(errBody(ERROR_CODES.AUTH_REQUIRED, "Session revoked, please log in again"));
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    const message =
      error.name === "TokenExpiredError" ? "Session expired, please log in again" : "Invalid token";
    res.status(401).json(errBody(ERROR_CODES.AUTH_REQUIRED, message));
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
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "Admin access required"));
    }
    next();
  } catch (error) {
    res.status(500).json(errBody(ERROR_CODES.INTERNAL_ERROR, "Authorization check failed"));
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

/** Central owner-aware Event authorization shared by REST and Socket.IO. */
exports.canManageEvent = eventPermissions.canManageEvent;

/**
 * Route guard for an Event-scoped management action. Resolves the event id
 * from the standard REST path or body; controllers must still authorize any
 * secondary event loaded from a record/token (e.g. a ticket scan).
 */
exports.requireEventManager = async (req, res, next) => {
  try {
    const eventId = req.params?.eventId || req.params?.id || req.body?.eventId;
    if (!eventId) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Event id is required"));
    }
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Event not found"));
    if (!(await eventPermissions.canManageEvent(req.user, event))) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't manage this event"));
    }
    req.managedEvent = event;
    next();
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid event id"));
    }
    console.error("Event authorization error:", error.message);
    res.status(500).json(errBody(ERROR_CODES.INTERNAL_ERROR, "Authorization check failed"));
  }
};

/**
 * Require the permanent Super Admin (Ownership Verification system).
 * Nobody else — not even platform admins — passes this check.
 */
exports.requireSuperAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("email").lean();
    if (!user || !isSuperAdminEmail(user.email)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "Super Admin access required"));
    }
    next();
  } catch (error) {
    res.status(500).json(errBody(ERROR_CODES.INTERNAL_ERROR, "Authorization check failed"));
  }
};
