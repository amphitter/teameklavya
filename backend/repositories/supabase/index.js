/**
 * Supabase repository barrel (Part 6, Phase 5 — §7, §8, §66)
 * ─────────────────────────────────────────────────────────────────────────────
 * The ONLY import surface for Supabase-backed data access.
 *
 * ── Why this file exists (§7, §66) ──
 * The MongoDB barrel (`repositories/index.js`) already declares domain
 * ownership:
 *
 *   EVENT DOMAIN  → EventRepository, RegistrationRepository
 *   SOCIAL DOMAIN → PostRepository, OrganizationRepository,
 *                   CommunityRepository, MessageRepository,
 *                   NotificationRepository
 *
 * and it says so explicitly: "moving the social collections to Postgres later
 * is a change inside these files — controllers stay untouched (§66)."
 *
 * This barrel is that change, prepared. Every class below mirrors the method
 * surface of its MongoDB counterpart, so Phase 6's cutover is a one-line swap
 * in `repositories/index.js` — not a rewrite of any controller.
 *
 * ── Phase 5 is PREPARATION, NOT CUTOVER (§10) ──
 * Nothing here is wired to a controller yet. MongoDB remains the source of
 * truth for the social domain until Phase 6 has backfilled, verified and
 * dual-read these tables. Importing this barrel is how Phase 6 tests will
 * exercise the schema; it is deliberately not how the running app reads data
 * today.
 *
 * ── Import rules ──
 *   • Import from HERE, never from `providers/supabase/` directly.
 *   • Never import this barrel from frontend-reachable code paths without
 *     going through a service — the service layer owns authorisation.
 *   • Every list method returns the shared page envelope
 *     `{ items, nextCursor, hasMore }` from `repositories/cursor.js`, so
 *     Mongo-backed and Postgres-backed responses are indistinguishable.
 */

"use strict";

const { BaseSupabaseRepository, toDomainError } = require("./base.repository");
const { ProfileRepository, FollowRepository, BlockRepository, PROFILE_COLUMNS } = require("./profile.repository");
const { OrganizationRepository, ORG_COLUMNS } = require("./organization.repository");
const { CommunityRepository, COMMUNITY_COLUMNS } = require("./community.repository");
const {
  PostRepository, ReactionRepository, CommentRepository, SavedPostRepository, POST_COLUMNS,
} = require("./post.repository");
const { MessageRepository } = require("./message.repository");
const { NotificationRepository, NOTIFICATION_COLUMNS } = require("./notification.repository");
const {
  ModerationRepository, AchievementRepository, EventInterestRepository,
} = require("./moderation.repository");

/**
 * Instances, not classes: these are stateless wrappers over a shared client,
 * so one instance per process is correct and avoids per-call allocation.
 */
const Profile = new ProfileRepository();
const Follow = new FollowRepository();
const Block = new BlockRepository();
const Organization = new OrganizationRepository();
const Community = new CommunityRepository();
const Post = new PostRepository();
const Reaction = new ReactionRepository();
const Comment = new CommentRepository();
const SavedPost = new SavedPostRepository();
const Message = new MessageRepository();
const Notification = new NotificationRepository();
const Moderation = new ModerationRepository();
const Achievement = new AchievementRepository();
const EventInterest = new EventInterestRepository();

/**
 * True when Supabase is configured and the social repositories are usable.
 * Phase 6 services check this before reading, so an unconfigured store
 * degrades to MongoDB rather than erroring (§15).
 */
function isAvailable() {
  return require("../../providers/supabase").isConfigured();
}

module.exports = {
  // ── infrastructure ──
  BaseSupabaseRepository,
  toDomainError,
  isAvailable,

  // ── identity & social graph (§9: one canonical id) ──
  Profile,
  Follow,
  Block,

  // ── organizations & communities ──
  Organization,
  Community,

  // ── content & engagement ──
  Post,
  Reaction,
  Comment,
  SavedPost,

  // ── messaging & notifications ──
  Message,
  Notification,

  // ── moderation & achievements ──
  Moderation,
  Achievement,
  EventInterest,

  // ── projections (§5) ──
  PROFILE_COLUMNS,
  ORG_COLUMNS,
  COMMUNITY_COLUMNS,
  POST_COLUMNS,
  NOTIFICATION_COLUMNS,
};
