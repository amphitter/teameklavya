"use strict";

const { checkFeatureRestriction } = require("../services/enforcement.service");
const { ERROR_CODES } = require("../utils/app-error");

function errBody(code, message, extra = {}) {
  return { success: false, message, error: { code, message }, ...extra };
}

// Generic feature restriction checker
function requireFeature(feature) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) return next();
      const check = await checkFeatureRestriction(userId, feature);
      if (check.restricted) {
        const msg = check.reason
          ? `Your account is restricted from ${feature}: ${check.reason}${check.expiresAt ? ` (until ${new Date(check.expiresAt).toLocaleDateString()})` : ""}`
          : `Your account is restricted from ${feature}`;
        return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, msg, { restricted: true, feature, expiresAt: check.expiresAt, type: check.type }));
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  requireFeature,
  requirePosting: requireFeature("posting"),
  requireCommenting: requireFeature("commenting"),
  requireMessaging: requireFeature("messaging"),
  requireEventCreation: requireFeature("eventCreation"),
};
