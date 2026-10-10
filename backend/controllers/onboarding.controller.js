"use strict";

const { ERROR_CODES } = require("../utils/app-error");
const onboardingService = require("../services/onboarding.service");
const Organization = require("../models/organization.model");

function errBody(code, message) {
  return { success: false, message, error: { code, message } };
}

// GET /api/onboarding/status
exports.getStatus = async (req, res, next) => {
  try {
    const status = await onboardingService.getOnboardingStatus(req.user.id);
    return res.json({ success: true, ...status });
  } catch (error) {
    return next(error);
  }
};

// GET /api/users/check-username?username=foo
exports.checkUsername = async (req, res, next) => {
  try {
    const username = String(req.query.username || "").trim();
    if (!username) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Username required"));
    // Privacy-preserving: don't leak private info, just available/taken/invalid
    const result = await onboardingService.checkUsernameAvailability(username, req.user?.id || null);
    return res.json({ success: true, available: result.available, reason: result.reason, message: result.message, normalized: result.normalized });
  } catch (error) {
    return next(error);
  }
};

// POST /api/onboarding/username
exports.setUsername = async (req, res, next) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Username required"));
    const result = await onboardingService.setUsername({ userId: req.user.id, username, isOnboarding: true });
    return res.json({ success: true, user: { username: result.user.username, usernameLastChangedAt: result.user.usernameLastChangedAt }, isFirstTime: result.isFirstTime });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// POST /api/onboarding/age-confirm
exports.confirmAge = async (req, res, next) => {
  try {
    const { confirmed, ageConfirmed } = req.body;
    const isConfirmed = confirmed === true || ageConfirmed === true || confirmed === "true";
    if (!isConfirmed) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Age confirmation required"));
    const user = await onboardingService.confirmAge({ userId: req.user.id, confirmed: true });
    return res.json({ success: true, ageConfirmed: user.ageConfirmed, ageConfirmedAt: user.ageConfirmedAt });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// PUT /api/onboarding/privacy
exports.setPrivacy = async (req, res, next) => {
  try {
    const { visibility, profileVisibility } = req.body;
    const vis = visibility || profileVisibility;
    if (!vis) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Visibility required"));
    const user = await onboardingService.setPrivacy({ userId: req.user.id, visibility: vis });
    return res.json({ success: true, socialSettings: user.socialSettings });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// POST /api/onboarding/media
exports.setMedia = async (req, res, next) => {
  try {
    const { avatar, coverImage, coverPosition, avatarCrop, coverCrop } = req.body;
    const user = await onboardingService.setMedia({ userId: req.user.id, avatar, coverImage, coverPosition, avatarCrop, coverCrop });
    return res.json({ success: true, profile: { avatar: user.profile.avatar, coverImage: user.profile.coverImage, coverPosition: user.profile.coverPosition } });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// PUT /api/onboarding/bio
exports.setBio = async (req, res, next) => {
  try {
    const { bio } = req.body;
    const user = await onboardingService.setBio({ userId: req.user.id, bio });
    return res.json({ success: true, bio: user.profile.bio });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// PUT /api/onboarding/institution
exports.setInstitution = async (req, res, next) => {
  try {
    const { organizationId, institutionOrgId } = req.body;
    const orgId = organizationId || institutionOrgId || null;
    // Allow null to skip
    const user = await onboardingService.setInstitution({ userId: req.user.id, organizationId: orgId });
    return res.json({ success: true, institutionOrgId: user.institutionOrgId, institution: user.profile.institution });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// PUT /api/onboarding/interests
exports.setInterests = async (req, res, next) => {
  try {
    const { interests } = req.body;
    const user = await onboardingService.setInterests({ userId: req.user.id, interests });
    return res.json({ success: true, interests: user.interestsV2, profileInterests: user.profile.interests });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// POST /api/onboarding/complete
exports.complete = async (req, res, next) => {
  try {
    const user = await onboardingService.completeOnboarding(req.user.id);
    return res.json({ success: true, onboardingCompletedAt: user.onboardingCompletedAt, onboardingVersion: user.onboardingVersion });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// GET /api/onboarding/institutions?search=&limit=
exports.listInstitutions = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const query = { status: "APPROVED" };
    if (req.query.search) {
      const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [{ name: { $regex: escaped, $options: "i" } }, { city: { $regex: escaped, $options: "i" } }];
    }
    const orgs = await Organization.find(query).select("name slug city category").sort({ name: 1 }).limit(limit).lean();
    return res.json({ success: true, organizations: orgs, taxonomy: onboardingService.INTEREST_TAXONOMY });
  } catch (error) {
    return next(error);
  }
};
