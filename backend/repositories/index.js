/**
 * Repository barrel (Part 5, Phase 3 — spec §2, §4)
 * ──────────────────────────────────────────────────
 * The ONLY import surface for database access.
 *
 * §2 DOMAIN OWNERSHIP is expressed here — one line per domain, so the split
 * is legible even though both domains currently share one MongoDB:
 *
 *   EVENT DOMAIN  → EventRepository, RegistrationRepository
 *   SOCIAL DOMAIN → PostRepository, OrganizationRepository,
 *                   CommunityRepository, MessageRepository,
 *                   NotificationRepository
 *
 * Because ownership is enforced at this layer (not at the database), moving
 * the social collections to Postgres later is a change inside these files —
 * controllers, services and the frontend stay untouched (§66).
 *
 * Import from here, never from `../models/...` inside a controller.
 */

const { EventRepository } = require("./event.repository");
const { RegistrationRepository } = require("./registration.repository");
const { PostRepository } = require("./post.repository");
const { OrganizationRepository } = require("./organization.repository");
const { CommunityRepository } = require("./community.repository");
const { MessageRepository } = require("./message.repository");
const { NotificationRepository } = require("./notification.repository");
const cursor = require("./cursor");

module.exports = {
  // ── EVENT DOMAIN ──
  EventRepository,
  RegistrationRepository,

  // ── SOCIAL DOMAIN ──
  PostRepository,
  OrganizationRepository,
  CommunityRepository,
  MessageRepository,
  NotificationRepository,

  // ── shared pagination primitives (§7) ──
  cursor,
};
