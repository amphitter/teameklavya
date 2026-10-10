"use strict";

/**
 * Onboarding Service — User onboarding and profile personalization
 * Handles username selection with 14-day cooldown, age confirmation, privacy, avatar/banner, bio, institution, interests, progressive onboarding.
 */

const mongoose = require("mongoose");
const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const { ValidationError, ConflictError, NotFoundError } = require("../utils/app-error");

// Reserved usernames (same as user.controller but extended)
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "api",
  "auth",
  "login",
  "logout",
  "signup",
  "register",
  "events",
  "event",
  "explore",
  "feed",
  "home",
  "messages",
  "message",
  "notifications",
  "organizations",
  "organization",
  "orgs",
  "profile",
  "user",
  "users",
  "post",
  "posts",
  "saved",
  "community",
  "communities",
  "quiz",
  "quizzes",
  "support",
  "help",
  "root",
  "system",
  "moderator",
  "moderators",
  "official",
  "eventhub",
  "teameklavya",
  "onboarding",
  "settings",
  "privacy",
  "terms",
  "about",
  "contact",
  "null",
  "undefined",
  "anonymous",
]);

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const USERNAME_COOLDOWN_DAYS = Number(process.env.USERNAME_COOLDOWN_DAYS || 14);
const USERNAME_COOLDOWN_MS = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// Interest taxonomy — stable IDs
const INTEREST_TAXONOMY = [
  { id: "technology", label: "Technology" },
  { id: "ai", label: "Artificial Intelligence" },
  { id: "programming", label: "Programming" },
  { id: "gaming", label: "Gaming" },
  { id: "music", label: "Music" },
  { id: "sports", label: "Sports" },
  { id: "design", label: "Design" },
  { id: "startups", label: "Startups" },
  { id: "entrepreneurship", label: "Entrepreneurship" },
  { id: "education", label: "Education" },
  { id: "hackathons", label: "Hackathons" },
  { id: "events", label: "Events" },
  { id: "science", label: "Science" },
  { id: "photography", label: "Photography" },
  { id: "business", label: "Business" },
  { id: "art", label: "Art" },
  { id: "fitness", label: "Fitness" },
  { id: "travel", label: "Travel" },
  { id: "food", label: "Food" },
  { id: "health", label: "Health" },
];

const INTEREST_IDS = new Set(INTEREST_TAXONOMY.map((i) => i.id));

function normalizeUsername(username) {
  return String(username || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

function validateUsername(username) {
  const errors = [];
  if (!username || typeof username !== "string") {
    errors.push("Username is required");
    return errors;
  }
  const normalized = normalizeUsername(username);
  if (!USERNAME_RE.test(normalized)) {
    errors.push("Username must be 3-30 characters: lowercase letters, numbers, underscore only");
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    errors.push("That username is reserved");
  }
  // Prohibited impersonation patterns: e.g. containing admin, official, etc. unless user is super admin
  const lower = normalized.toLowerCase();
  if (/(admin|official|moderator|support|eventhub|teameklavya)/.test(lower) && !["admin", "official"].includes(lower)) {
    // Allow exact matches already blocked by reserved, but block impersonation like admin_user, official_eventhub etc.
    // We check if it contains reserved as substring with extra chars
    for (const reserved of RESERVED_USERNAMES) {
      if (lower.includes(reserved) && lower !== reserved) {
        // Allow if it's just containing, but block if it's trying to impersonate? For now, block if it starts with reserved
        if (lower.startsWith(reserved) || lower.endsWith(reserved)) {
          errors.push("Username contains reserved word");
          break;
        }
      }
    }
  }
  return errors;
}

async function checkUsernameAvailability(username, excludeUserId = null) {
  const normalized = normalizeUsername(username);
  const errors = validateUsername(normalized);
  if (errors.length) {
    return { available: false, reason: "invalid", message: errors[0], normalized };
  }
  const query = { username: normalized };
  if (excludeUserId) query._id = { $ne: excludeUserId };
  const existing = await User.exists(query);
  if (existing) {
    return { available: false, reason: "taken", message: "That username is already taken", normalized };
  }
  return { available: true, normalized };
}

// 14-day cooldown enforcement
function canChangeUsername(user) {
  // First-time assignment: no cooldown, but must not have username
  if (!user.username) {
    return { allowed: true, isFirstTime: true };
  }
  if (!user.usernameLastChangedAt) {
    // Legacy user without timestamp - allow once, then set timestamp
    return { allowed: true, isFirstTime: false, legacy: true };
  }
  const lastChanged = new Date(user.usernameLastChangedAt).getTime();
  const now = Date.now();
  const elapsed = now - lastChanged;
  if (elapsed < USERNAME_COOLDOWN_MS) {
    const remainingMs = USERNAME_COOLDOWN_MS - elapsed;
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return {
      allowed: false,
      remainingMs,
      remainingDays,
      message: `You can change your username again in ${remainingDays} day(s). Last changed ${new Date(lastChanged).toLocaleDateString()}`,
    };
  }
  return { allowed: true, isFirstTime: false };
}

async function setUsername({ userId, username, isOnboarding = false }) {
  const normalized = normalizeUsername(username);
  const validationErrors = validateUsername(normalized);
  if (validationErrors.length) {
    throw new ValidationError(validationErrors[0]);
  }

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  // Prevent bypass via same username resubmit or case-only changes
  // If normalized is same as current, reject as no-op (prevent cooldown bypass)
  if (user.username && normalizeUsername(user.username) === normalized) {
    // If it's exactly same (including case), treat as no change - don't update timestamp
    // If case differs but normalized same, it's already same username (since we store lowercase), so reject
    throw new ValidationError("That is already your username");
  }

  // Cooldown check
  const cooldownCheck = canChangeUsername(user);
  if (!cooldownCheck.allowed) {
    throw new ValidationError(cooldownCheck.message);
  }

  // Concurrent safe: try to update with unique index handling
  // Check availability again with exclude
  const availability = await checkUsernameAvailability(normalized, userId);
  if (!availability.available) {
    throw new ConflictError(availability.message);
  }

  const now = new Date();
  const wasFirstTime = !user.username;

  user.username = normalized;
  user.usernameLastChangedAt = now;
  if (wasFirstTime) {
    user.usernameFirstSetAt = now;
  }
  // Update onboarding step
  if (user.onboardingSteps) {
    user.onboardingSteps.username = true;
  }

  try {
    await user.save();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("That username is already taken");
    }
    throw err;
  }

  return { user, isFirstTime: wasFirstTime };
}

// Age confirmation
async function confirmAge({ userId, confirmed }) {
  if (!confirmed) {
    throw new ValidationError("Age confirmation is required");
  }
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  // Record confirmation and timestamp - do NOT store DOB
  user.ageConfirmed = true;
  user.ageConfirmedAt = new Date();
  if (user.onboardingSteps) {
    user.onboardingSteps.age = true;
  }
  await user.save();
  return user;
}

// Privacy selection
async function setPrivacy({ userId, visibility }) {
  if (!["public", "private", "followers"].includes(visibility)) {
    throw new ValidationError("Invalid privacy setting");
  }
  // Map private to private, public to public, followers to followers (but spec says public/private choice)
  // For onboarding we allow public or private; followers is intermediate but we support
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  // Explain consequences in backend comment, but frontend should show explanation
  user.socialSettings = user.socialSettings || {};
  user.socialSettings.profileVisibility = visibility;
  if (user.onboardingSteps) {
    user.onboardingSteps.privacy = true;
  }
  await user.save();
  return user;
}

// Avatar/banner
async function setMedia({ userId, avatar, coverImage, coverPosition, avatarCrop, coverCrop }) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!user.profile) user.profile = {};

  if (avatar !== undefined) {
    // Validate URL via same logic as user.controller
    if (avatar) {
      // Basic URL validation - allow /uploads/ or http(s)
      const isUpload = String(avatar).startsWith("/uploads/");
      const isHttp = /^https?:\/\//.test(String(avatar));
      if (!isUpload && !isHttp) throw new ValidationError("Invalid avatar URL");
    }
    user.profile.avatar = avatar || "";
    if (!avatar) user.profile.avatarCrop = null;
    else if (avatar) {
      user.profile.avatarVersion = (user.profile.avatarVersion || 0) + 1;
    }
  }
  if (coverImage !== undefined) {
    if (coverImage) {
      const isUpload = String(coverImage).startsWith("/uploads/");
      const isHttp = /^https?:\/\//.test(String(coverImage));
      if (!isUpload && !isHttp) throw new ValidationError("Invalid cover image URL");
    }
    user.profile.coverImage = coverImage || "";
    if (!coverImage) {
      user.profile.coverPosition = 50;
      user.profile.coverCrop = null;
    } else {
      user.profile.coverVersion = (user.profile.coverVersion || 0) + 1;
    }
  }
  if (coverPosition !== undefined) {
    const pos = Number(coverPosition);
    if (Number.isFinite(pos)) {
      user.profile.coverPosition = Math.min(100, Math.max(0, Math.round(pos)));
    }
  }
  if (avatarCrop !== undefined) {
    user.profile.avatarCrop = avatarCrop;
  }
  if (coverCrop !== undefined) {
    user.profile.coverCrop = coverCrop;
  }

  if (user.onboardingSteps) {
    // If either avatar or cover provided, mark step as done (even if skipped, we mark as done to not prompt again? Actually spec says preserve existing when skip)
    // For onboarding, if user uploads at least one, mark as done
    if (avatar || coverImage) {
      user.onboardingSteps.avatarBanner = true;
    }
  }

  await user.save();
  return user;
}

// Bio with moderation
async function setBio({ userId, bio }) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!user.profile) user.profile = {};

  const trimmed = String(bio || "").trim().slice(0, 500);
  // Moderate bio text
  try {
    const moderationService = require("./moderation.service");
    const modResult = await moderationService.moderateText({ text: trimmed, contentType: "user_bio", authorId: userId });
    if (modResult.status === "quarantined" || (modResult.confidence >= 0.85 && modResult.categories.length)) {
      throw new ValidationError("Bio contains prohibited content: " + (modResult.categories.join(", ") || modResult.reason));
    }
    if (modResult.status === "flagged") {
      // For bio, flagged still blocks if medium confidence abusive
      if (modResult.confidence >= 0.6) {
        throw new ValidationError("Bio flagged for review: " + (modResult.reason || "prohibited content"));
      }
    }
  } catch (err) {
    if (err.status) throw err;
    // If validation error from moderation, propagate
    if (err.message && err.message.includes("prohibited")) throw err;
    console.warn("Bio moderation failed, allowing with caution:", err.message);
  }

  user.profile.bio = trimmed.slice(0, 280);
  if (user.onboardingSteps) {
    user.onboardingSteps.bio = true;
  }
  await user.save();
  return user;
}

// Institution selection from approved organizations
async function setInstitution({ userId, organizationId }) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");
  if (!user.profile) user.profile = {};

  if (!organizationId) {
    // Skip: clear institution
    user.institutionOrgId = null;
    user.profile.institution = "";
    if (user.onboardingSteps) {
      user.onboardingSteps.institution = true; // skipped counts as completed for progressive onboarding
    }
    await user.save();
    return user;
  }

  if (!mongoose.Types.ObjectId.isValid(String(organizationId))) {
    throw new ValidationError("Invalid institution id");
  }

  const org = await Organization.findById(organizationId).select("name category status").lean();
  if (!org) throw new NotFoundError("Institution not found");
  if (org.status !== "APPROVED") {
    throw new ValidationError("Institution is not approved");
  }
  // Only allow college/university/school/institute
  const allowedCategories = ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE", "OTHER"];
  // For onboarding, we allow any approved org but prefer educational
  // Do not treat as proof of enrollment

  user.institutionOrgId = org._id;
  user.profile.institution = org.name; // keep string for backward compat
  if (user.onboardingSteps) {
    user.onboardingSteps.institution = true;
  }
  await user.save();
  return user;
}

// Interests
async function setInterests({ userId, interests }) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  if (!interests) {
    // Skip
    if (user.onboardingSteps) {
      user.onboardingSteps.interests = true;
    }
    await user.save();
    return user;
  }

  const list = Array.isArray(interests) ? interests : [];
  const cleaned = [...new Set(list.map((t) => String(t).toLowerCase().trim()).filter(Boolean))];
  // Validate against taxonomy stable IDs
  const valid = cleaned.filter((id) => INTEREST_IDS.has(id));
  if (valid.length > 10) {
    throw new ValidationError("You can select at most 10 interests");
  }

  user.interestsV2 = valid;
  user.profile.interests = valid; // keep backward compat
  if (user.onboardingSteps) {
    user.onboardingSteps.interests = true;
  }
  await user.save();
  return user;
}

// Get onboarding status - progressive for existing users
async function getOnboardingStatus(userId) {
  const user = await User.findById(userId)
    .select("username ageConfirmed socialSettings profile institutionOrgId interestsV2 onboardingVersion onboardingCompletedAt onboardingSteps usernameLastChangedAt")
    .populate("institutionOrgId", "name slug category")
    .lean();

  if (!user) throw new NotFoundError("User not found");

  const steps = {
    username: Boolean(user.username && user.username.length >= 3),
    age: Boolean(user.ageConfirmed),
    privacy: Boolean(user.socialSettings?.profileVisibility && ["public", "private", "followers"].includes(user.socialSettings.profileVisibility)),
    avatarBanner: Boolean(user.profile?.avatar || user.profile?.coverImage),
    bio: Boolean(user.profile?.bio && user.profile.bio.trim().length > 0),
    institution: Boolean(user.institutionOrgId || (user.profile?.institution && user.profile.institution.trim().length > 0)),
    interests: Boolean((user.interestsV2 && user.interestsV2.length > 0) || (user.profile?.interests && user.profile.interests.length > 0)),
  };

  // Required steps: username, age, privacy
  const requiredSteps = ["username", "age", "privacy"];
  const optionalSteps = ["avatarBanner", "bio", "institution", "interests"];

  const requiredCompleted = requiredSteps.every((s) => steps[s]);
  const optionalCompleted = optionalSteps.filter((s) => steps[s]).length;

  const incompleteRequired = requiredSteps.filter((s) => !steps[s]);
  const incompleteOptional = optionalSteps.filter((s) => !steps[s]);

  // Onboarding version for server-authoritative completion metadata
  const currentVersion = 1;

  return {
    user: {
      _id: user._id,
      username: user.username,
      ageConfirmed: user.ageConfirmed,
      socialSettings: user.socialSettings,
      profile: user.profile,
      institutionOrgId: user.institutionOrgId,
      interestsV2: user.interestsV2,
      onboardingVersion: user.onboardingVersion,
      onboardingCompletedAt: user.onboardingCompletedAt,
      onboardingSteps: user.onboardingSteps || steps,
    },
    steps,
    requiredSteps,
    optionalSteps,
    requiredCompleted,
    incompleteRequired,
    incompleteOptional,
    optionalCompleted,
    isComplete: requiredCompleted,
    currentVersion,
    taxonomy: INTEREST_TAXONOMY,
  };
}

// Complete onboarding
async function completeOnboarding(userId) {
  const status = await getOnboardingStatus(userId);
  if (!status.requiredCompleted) {
    throw new ValidationError(`Required steps incomplete: ${status.incompleteRequired.join(", ")}`);
  }
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  user.onboardingVersion = status.currentVersion;
  user.onboardingCompletedAt = new Date();
  // Merge steps
  user.onboardingSteps = {
    ...user.onboardingSteps,
    ...status.steps,
  };
  await user.save();
  return user;
}

module.exports = {
  RESERVED_USERNAMES,
  USERNAME_RE,
  USERNAME_COOLDOWN_DAYS,
  INTEREST_TAXONOMY,
  INTEREST_IDS,
  normalizeUsername,
  validateUsername,
  checkUsernameAvailability,
  canChangeUsername,
  setUsername,
  confirmAge,
  setPrivacy,
  setMedia,
  setBio,
  setInstitution,
  setInterests,
  getOnboardingStatus,
  completeOnboarding,
};
