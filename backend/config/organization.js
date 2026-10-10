"use strict";

/**
 * Canonical Organization category and lifecycle configuration.
 *
 * COLLEGE_COMMUNITY and UNIVERSITY_COMMUNITY are included because the Phase 3
 * parent-link rules explicitly name them, although they were omitted from the
 * initial category list. Keep this list as the single source of truth for the
 * Organization model and backend validation.
 */
const ORGANIZATION_CATEGORIES = Object.freeze([
  "COLLEGE",
  "UNIVERSITY",
  "SCHOOL",
  "COMPANY",
  "STARTUP",
  "STUDENT_CLUB",
  "COLLEGE_CLUB",
  "COLLEGE_COMMUNITY",
  "UNIVERSITY_COMMUNITY",
  "COMMUNITY",
  "TECH_COMMUNITY",
  "CULTURAL_CLUB",
  "SPORTS_CLUB",
  "NGO",
  "INSTITUTE",
  "OTHER",
]);

const ORGANIZATION_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "REVOKED",
]);

const ORGANIZATION_VERIFICATION_STATUSES = Object.freeze([
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "SUSPENDED",
  "REVOKED",
]);

const ORGANIZATION_OWNERSHIP_STATUSES = Object.freeze([
  "PERSONAL",
  "CLAIM_PENDING",
  "ORGANIZATION_VERIFIED",
  "TRANSFER_PENDING",
  "DISPUTED",
  "REVOKED",
]);

const ORGANIZATION_ROLES = Object.freeze([
  "OWNER",
  "ADMIN",
  "MANAGER",
  "EDITOR",
  "EVENT_MANAGER",
  "MEMBER",
]);

const ORGANIZATION_MEMBERSHIP_STATUSES = Object.freeze([
  "ACTIVE",
  "PENDING",
  "INVITED",
  "SUSPENDED",
  "REVOKED",
]);

/**
 * Phase 3 affiliation rules. These describe an explicit directory/profile
 * association only; they do not confer verification, ownership, or RBAC.
 * Clubs may choose one eligible institution as their direct parent.
 */
const ORGANIZATION_PARENT_CATEGORIES = Object.freeze([
  "COLLEGE",
  "UNIVERSITY",
  "SCHOOL",
  "INSTITUTE",
]);
const ORGANIZATION_PARENT_LINKS = Object.freeze({
  STUDENT_CLUB: Object.freeze(["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"]),
  COLLEGE_CLUB: Object.freeze(["COLLEGE", "UNIVERSITY"]),
  COLLEGE_COMMUNITY: Object.freeze(["COLLEGE", "UNIVERSITY"]),
  UNIVERSITY_COMMUNITY: Object.freeze(["UNIVERSITY"]),
  CULTURAL_CLUB: Object.freeze(["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"]),
  SPORTS_CLUB: Object.freeze(["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"]),
});

function parentCategoriesForOrganization(category) {
  return ORGANIZATION_PARENT_LINKS[String(category || "").trim().toUpperCase()] || [];
}

function childCategoriesForOrganization(category) {
  const normalized = String(category || "").trim().toUpperCase();
  return Object.entries(ORGANIZATION_PARENT_LINKS)
    .filter(([, parents]) => parents.includes(normalized))
    .map(([childCategory]) => childCategory);
}

// ── Master Refactor: Institution vs Club distinction ────────────────
const INSTITUTION_CATEGORIES = Object.freeze([
  "COLLEGE",
  "UNIVERSITY",
  "SCHOOL",
  "INSTITUTE",
]);

const CLUB_CATEGORIES = Object.freeze([
  "STUDENT_CLUB",
  "COLLEGE_CLUB",
  "CULTURAL_CLUB",
  "SPORTS_CLUB",
  "TECH_COMMUNITY",
  "COLLEGE_COMMUNITY",
  "UNIVERSITY_COMMUNITY",
]);

const ORGANIZATION_AFFILIATION_STATUSES = Object.freeze([
  "NONE",
  "PENDING",
  "APPROVED",
  "SUSPENDED",
  "REVOKED",
  "REJECTED",
]);

function isInstitutionCategory(category) {
  return INSTITUTION_CATEGORIES.includes(String(category || "").trim().toUpperCase());
}

function isClubCategory(category) {
  return CLUB_CATEGORIES.includes(String(category || "").trim().toUpperCase());
}

function normalizeCategory(category) {
  return String(category || "").trim().toUpperCase();
}

module.exports = {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_VERIFICATION_STATUSES,
  ORGANIZATION_OWNERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  ORGANIZATION_MEMBERSHIP_STATUSES,
  ORGANIZATION_PARENT_CATEGORIES,
  ORGANIZATION_PARENT_LINKS,
  ORGANIZATION_AFFILIATION_STATUSES,
  INSTITUTION_CATEGORIES,
  CLUB_CATEGORIES,
  parentCategoriesForOrganization,
  childCategoriesForOrganization,
  isInstitutionCategory,
  isClubCategory,
  normalizeCategory,
};
