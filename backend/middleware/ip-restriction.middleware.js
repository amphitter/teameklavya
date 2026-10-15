"use strict";

const { isIpRestricted, getClientIp } = require("../services/abuse.service");

async function checkIpRestriction(req, res, next) {
  try {
    const ip = getClientIp(req);
    if (!ip || ip === "unknown") return next();
    const result = await isIpRestricted(ip);
    if (result.restricted) {
      const restriction = result.restriction;
      // Don't treat IP as conclusive user identity — show reason but allow appeal path
      return res.status(403).json({
        success: false,
        message: restriction.reason ? `Access restricted: ${restriction.reason}` : "Access temporarily restricted from this network",
        error: { code: "FORBIDDEN", message: "IP restricted", expiresAt: restriction.expiresAt, category: restriction.category },
      });
    }
    return next();
  } catch (err) {
    // Fail open: IP check failure should not block legitimate users
    console.warn("[ip-restriction] check failed:", err.message);
    return next();
  }
}

module.exports = { checkIpRestriction };
