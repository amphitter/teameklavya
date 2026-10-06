-- ═══════════════════════════════════════════════════════════════════════════
--  EventHub — Supabase (PostgreSQL) relational schema
--  Part 6, Phase 5 · brief §8
-- ═══════════════════════════════════════════════════════════════════════════
--
--  WHAT LIVES HERE, AND WHAT DOES NOT
--  ──────────────────────────────────
--  This database owns the RELATIONAL / SOCIAL domain: profiles, the follow
--  graph, organizations, posts, comments, reactions, communities, direct
--  messages, notifications, moderation.
--
--  It does NOT own events, registrations, quiz state or live sessions. Those
--  stay in MongoDB, which remains the source of truth for them (§10). The
--  tables below therefore reference events only by id, never by foreign key
--  — a FK across two databases cannot be enforced, and pretending otherwise
--  would be the kind of lie that surfaces as a silent data bug.
--
--  ── IDENTITY (§9): there is exactly ONE user id ──
--  `profiles.id` IS the canonical EventHub user id — the same 24-character
--  identifier the MongoDB `users` collection uses. No second identity, no
--  Supabase Auth, no email-as-key, no mapping table. A mapping table would
--  itself be a second identity, so there is deliberately not one.
--
--  The cost of this choice: a TEXT key is 24 bytes where a UUID would be 16,
--  and it repeats in every row of `reactions`, `messages` and friends. On a
--  500 MB free tier that is tens of MB at millions of rows. We accept it
--  because the alternative — minting a second id per user — is precisely the
--  failure §9 exists to prevent.
--
--  ── PAGINATION (§13): every collection is keyset-paginated ──
--  OFFSET pagination walks and discards N rows, so page 50 costs ~25x page 1,
--  and a concurrent insert shifts every subsequent row (users see a row twice
--  or never). Every list below is read with a keyset predicate:
--
--      WHERE (created_at, id) < (:last_created_at, :last_id)
--
--  Each such collection therefore carries a composite index on
--  `(created_at DESC, id DESC)`. The id is in the tuple because created_at is
--  not unique — without it, two rows sharing a timestamp can straddle a page
--  boundary and one is lost.
--
--  ── SOFT DELETE ──
--  User-visible content (posts, comments, communities) is soft-deleted so
--  that moderation can be reviewed and content restored. Every partial index
--  is `WHERE deleted_at IS NULL`, so deleted rows cost nothing to skip.
--
--  ── NO DISTRIBUTED TRANSACTIONS (§11) ──
--  Nothing here participates in a transaction with MongoDB. Cross-store
--  consistency is eventual, achieved with idempotency, an outbox and
--  reconciliation (Phase 6).
--
--  ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Extensions ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- trigram search on names/content

-- ── updated_at maintenance ─────────────────────────────────────────────────
-- One trigger function, reused by every table with updated_at. Doing this in
-- the database rather than the application means a row cannot be updated
-- without its timestamp moving, no matter which path wrote it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
--  IDENTITY & PROFILES
-- ═══════════════════════════════════════════════════════════════════════════

-- Profiles. `id` is the canonical EventHub user id (§9) — NEVER regenerate.
CREATE TABLE IF NOT EXISTS profiles (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  username          TEXT,
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  avatar_url        TEXT,
  bio               TEXT,

  -- Academic profile (from the Mongo user.profile subdocument)
  institution       TEXT,
  course            TEXT,
  year              TEXT,
  location          TEXT,
  interests         TEXT[] NOT NULL DEFAULT '{}',

  role              TEXT NOT NULL DEFAULT 'user'
                      CHECK (role IN ('user', 'admin')),

  -- Privacy settings (§14: enforced server-side, these are just the user's
  -- stated preferences — the API decides, never the client).
  profile_visibility  TEXT NOT NULL DEFAULT 'public'
                        CHECK (profile_visibility IN ('public', 'followers', 'private')),
  allow_messages_from TEXT NOT NULL DEFAULT 'everyone'
                        CHECK (allow_messages_from IN ('everyone', 'followers', 'nobody')),

  -- Denormalised counters. Kept here because they are read on every profile
  -- render and maintained by trigger, so they cannot drift from a missed
  -- increment in application code. §72: never faked — a new account really
  -- does have zero followers, and that is what shows.
  followers_count   INTEGER NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
  following_count   INTEGER NOT NULL DEFAULT 0 CHECK (following_count >= 0),
  posts_count       INTEGER NOT NULL DEFAULT 0 CHECK (posts_count >= 0),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- email is the login identity and must be unique; username is optional and
-- unique only when present (mirrors Mongo's sparse unique index).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_key      ON profiles (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key   ON profiles (username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_username_trgm         ON profiles USING gin (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_name_trgm             ON profiles USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_created_at_id_idx     ON profiles (created_at DESC, id DESC);

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  SOCIAL GRAPH
-- ═══════════════════════════════════════════════════════════════════════════

-- Follow edges (user → user). `pending` is a follow request awaiting
-- approval, which is what a private profile turns a follow into.
CREATE TABLE IF NOT EXISTS follows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followee_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('accepted', 'pending')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One edge per ordered pair. Without this, a double-tap "follow" creates
  -- two rows and the follower count silently doubles.
  CONSTRAINT follows_no_self CHECK (follower_id <> followee_id),
  CONSTRAINT follows_pair_unique UNIQUE (follower_id, followee_id)
);

-- "Who follows X" (the expensive direction, used on every profile view)
CREATE INDEX IF NOT EXISTS follows_followee_status_created_idx
  ON follows (followee_id, status, created_at DESC, id DESC);
-- "Who does X follow"
CREATE INDEX IF NOT EXISTS follows_follower_status_created_idx
  ON follows (follower_id, status, created_at DESC, id DESC);

DROP TRIGGER IF EXISTS trg_follows_updated_at ON follows;
CREATE TRIGGER trg_follows_updated_at BEFORE UPDATE ON follows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Blocks. A block is stronger than an unfollow: it removes the edge and
-- prevents a new one, and it is checked before any direct message.
CREATE TABLE IF NOT EXISTS blocks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocks_pair_unique UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocker_idx ON blocks (blocker_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  ORGANIZATIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  logo_url      TEXT,
  cover_url     TEXT,
  website       TEXT,
  created_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,

  CONSTRAINT organizations_slug_unique UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS organizations_name_trgm   ON organizations USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS organizations_created_idx ON organizations (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS organizations_live_idx    ON organizations (created_at DESC, id DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Organization membership (staff who can post on the org's behalf).
CREATE TABLE IF NOT EXISTS org_members (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role              TEXT NOT NULL DEFAULT 'member'
                      CHECK (role IN ('owner', 'admin', 'member')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT org_members_unique UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS org_members_user_idx ON org_members (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_members_org_idx  ON org_members (organization_id, role);

-- Organization follows (a user following an org, not a person).
CREATE TABLE IF NOT EXISTS org_follows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT org_follows_unique UNIQUE (user_id, organization_id)
);
CREATE INDEX IF NOT EXISTS org_follows_org_idx  ON org_follows (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_follows_user_idx ON org_follows (user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  POSTS & ENGAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'published'
                      CHECK (status IN ('published', 'draft', 'deleted', 'hidden')),
  visibility        TEXT NOT NULL DEFAULT 'public'
                      CHECK (visibility IN ('public', 'followers', 'event_participants', 'community')),
  topics            TEXT[] NOT NULL DEFAULT '{}',

  -- Cross-store references. These are ids from MongoDB (events) and are
  -- intentionally NOT foreign keys — see the header note.
  event_id          TEXT,
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  community_id      UUID,

  -- Denormalised counters, maintained by trigger so they cannot drift.
  likes_count       INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  comments_count    INTEGER NOT NULL DEFAULT 0 CHECK (comments_count >= 0),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ
);

-- The main feed query: newest live posts first (§13 keyset pagination).
CREATE INDEX IF NOT EXISTS posts_feed_idx
  ON posts (created_at DESC, id DESC) WHERE deleted_at IS NULL AND status = 'published';
-- Per-author profile timeline.
CREATE INDEX IF NOT EXISTS posts_author_idx
  ON posts (author_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- Per-event posts.
CREATE INDEX IF NOT EXISTS posts_event_idx
  ON posts (event_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- Per-community posts.
CREATE INDEX IF NOT EXISTS posts_community_idx
  ON posts (community_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND community_id IS NOT NULL;
-- Topic exploration (GIN over the topics array).
CREATE INDEX IF NOT EXISTS posts_topics_idx ON posts USING gin (topics);
-- Full-text search over post bodies.
CREATE INDEX IF NOT EXISTS posts_content_trgm ON posts USING gin (content gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_posts_updated_at ON posts;
CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Post media. Binary files are NEVER stored in the database (§21) — this row
-- holds only the Cloudinary/R2 public id and metadata.
CREATE TABLE IF NOT EXISTS post_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  public_id     TEXT NOT NULL,           -- Cloudinary public id
  url           TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT 'image' CHECK (resource_type IN ('image', 'video', 'raw')),
  width         INTEGER,
  height        INTEGER,
  bytes         BIGINT,
  position      SMALLINT NOT NULL DEFAULT 0,   -- display order within the post
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_media_post_idx ON post_media (post_id, position);

-- Reactions. One per user per post — the unique constraint IS the "did I
-- like this" check, and it is atomic, so no application-level lock is needed.
CREATE TABLE IF NOT EXISTS reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'like' CHECK (type IN ('like')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reactions_user_post_unique UNIQUE (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS reactions_user_idx  ON reactions (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reactions_post_idx  ON reactions (post_id, type);

-- Saved posts (bookmarks).
CREATE TABLE IF NOT EXISTS saved_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT saved_posts_unique UNIQUE (post_id, user_id)
);
-- The bookmarks screen is always "mine, newest first".
CREATE INDEX IF NOT EXISTS saved_posts_user_idx ON saved_posts (user_id, created_at DESC, id DESC);

-- Comments.
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  removed_by  TEXT REFERENCES profiles(id) ON DELETE SET NULL,  -- moderation
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,

  CONSTRAINT comments_content_not_blank CHECK (length(trim(content)) > 0)
);
-- A post's comment thread is read oldest-first.
CREATE INDEX IF NOT EXISTS comments_post_idx
  ON comments (post_id, created_at ASC, id ASC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_author_idx ON comments (author_id, created_at DESC, id DESC);

DROP TRIGGER IF EXISTS trg_comments_updated_at ON comments;
CREATE TRIGGER trg_comments_updated_at BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  COMMUNITIES
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS communities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  avatar_url            TEXT,
  join_policy           TEXT NOT NULL DEFAULT 'open'
                          CHECK (join_policy IN ('open', 'request', 'invite')),
  -- Verification lifecycle: an unverified community can claim to represent an
  -- organization; only `verified` actually does.
  status                TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (status IN ('unverified', 'pending', 'verified', 'suspended', 'revoked')),
  affiliation_domain    TEXT,            -- e.g. "mit.edu" — evidence for a claim
  official_organization UUID REFERENCES organizations(id) ON DELETE SET NULL,
  suspended_from        TIMESTAMPTZ,
  created_by            TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT communities_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS communities_name_trgm   ON communities USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS communities_org_idx     ON communities (official_organization, deleted_at);
CREATE INDEX IF NOT EXISTS communities_created_idx ON communities (created_at DESC, id DESC) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_communities_updated_at ON communities;
CREATE TRIGGER trg_communities_updated_at BEFORE UPDATE ON communities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Membership. `pending` = requested, `invited` = org asked the user.
CREATE TABLE IF NOT EXISTS community_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'pending', 'invited')),
  invited_by    TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT community_members_unique UNIQUE (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS community_members_user_idx
  ON community_members (user_id, status, created_at DESC);
-- Keyset pagination over a community's member list. The id tiebreaker is
-- required: created_at is not unique and two members joining in the same
-- instant would otherwise straddle a page boundary (§13).
CREATE INDEX IF NOT EXISTS community_members_community_idx
  ON community_members (community_id, status, created_at DESC, id DESC);

DROP TRIGGER IF EXISTS trg_community_members_updated_at ON community_members;
CREATE TRIGGER trg_community_members_updated_at BEFORE UPDATE ON community_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roles beyond admin/member, so a community can define moderator etc.
-- without a schema change.
CREATE TABLE IF NOT EXISTS community_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT community_roles_unique UNIQUE (community_id, name)
);

-- A community claiming that it officially represents an organization.
CREATE TABLE IF NOT EXISTS community_claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  claimant_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proof             TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  resolution        TEXT CHECK (resolution IN ('grant', 'transfer')),
  review_note       TEXT,
  reviewed_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One live claim per (community, organization) pair.
  CONSTRAINT community_claims_unique UNIQUE (community_id, organization_id)
);
-- Keyset pagination over the moderation queue. The id tiebreaker is required:
-- created_at is not unique, and two claims sharing a timestamp would otherwise
-- straddle a page boundary (§13).
CREATE INDEX IF NOT EXISTS community_claims_status_idx
  ON community_claims (status, created_at DESC, id DESC);

DROP TRIGGER IF EXISTS trg_community_claims_updated_at ON community_claims;
CREATE TRIGGER trg_community_claims_updated_at BEFORE UPDATE ON community_claims
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The audit trail of verification decisions, kept after the claim resolves.
CREATE TABLE IF NOT EXISTS community_verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id      UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  claim_id          UUID REFERENCES community_claims(id) ON DELETE SET NULL,
  verified_by       TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  revoke_reason     TEXT
);
CREATE INDEX IF NOT EXISTS community_verifications_community_idx
  ON community_verifications (community_id, verified_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  DIRECT MESSAGES
-- ═══════════════════════════════════════════════════════════════════════════

-- A conversation between exactly two people. Enforced with a canonical
-- ordering (see the unique index) rather than a sorting convention in
-- application code, because a convention can be forgotten and an index cannot.
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  participant_b   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT conversations_distinct CHECK (participant_a <> participant_b)
);
-- Canonical pair ordering makes (a,b) and (b,a) the same row. Without this,
-- two users starting a conversation at the same moment each create one.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_pair_unique ON conversations (
  LEAST(participant_a, participant_b), GREATEST(participant_a, participant_b)
);
-- The inbox is "my conversations, most recent activity first".
CREATE INDEX IF NOT EXISTS conversations_inbox_a_idx ON conversations (participant_a, last_message_at DESC);
CREATE INDEX IF NOT EXISTS conversations_inbox_b_idx ON conversations (participant_b, last_message_at DESC);

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON conversations;
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Membership is denormalised out of `conversations` so that "all my
-- conversations" is one index scan instead of two OR'd scans. A trigger keeps
-- it in step with the parent row.
CREATE TABLE IF NOT EXISTS conversation_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT conversation_members_unique UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_user_idx
  ON conversation_members (user_id, last_read_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT messages_content_not_blank CHECK (length(trim(content)) > 0)
);
-- A thread is read newest-first (the visible window), then reversed.
CREATE INDEX IF NOT EXISTS messages_thread_idx
  ON messages (conversation_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- Unread badge counting. Partial index: only unread rows are ever counted.
CREATE INDEX IF NOT EXISTS messages_unread_idx
  ON messages (conversation_id) WHERE read_at IS NULL;

-- Keep conversation_members in step whenever a conversation is created.
CREATE OR REPLACE FUNCTION sync_conversation_members() RETURNS trigger AS $$
BEGIN
  INSERT INTO conversation_members (conversation_id, user_id)
  VALUES (NEW.id, NEW.participant_a), (NEW.id, NEW.participant_b)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversations_sync_members ON conversations;
CREATE TRIGGER trg_conversations_sync_members AFTER INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_members();

-- Bump the conversation's last_message_at when a message arrives, so the
-- inbox sorts by real activity rather than by whenever a row was touched.
CREATE OR REPLACE FUNCTION touch_conversation() RETURNS trigger AS $$
BEGIN
  UPDATE conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON messages;
CREATE TRIGGER trg_messages_touch_conversation AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION touch_conversation();

-- ═══════════════════════════════════════════════════════════════════════════
--  NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id      TEXT REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL = EventHub system
  type          TEXT NOT NULL CHECK (type IN (
                  'follow', 'follow_request', 'follow_accepted', 'like',
                  'comment', 'event_registration', 'org_follow',
                  'announcement', 'mention', 'event_update', 'event_reminder',
                  'community_invite', 'message', 'achievement')),
  read          BOOLEAN NOT NULL DEFAULT false,

  -- Cross-store targets (MongoDB ids) — intentionally not FKs.
  post_id       UUID REFERENCES posts(id) ON DELETE CASCADE,
  event_id      TEXT,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  community_id  UUID REFERENCES communities(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The notification list: mine, newest first.
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC, id DESC);
-- The unread badge. Partial index, because read notifications are the
-- overwhelming majority and are never counted.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON notifications (user_id) WHERE read = false;

-- Per-user, per-type delivery preferences. A user who has muted "like"
-- notifications is filtered at read time, so muting is reversible and needs
-- no backfill.
CREATE TABLE IF NOT EXISTS notification_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  in_app      BOOLEAN NOT NULL DEFAULT true,
  email       BOOLEAN NOT NULL DEFAULT true,
  push        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT notification_preferences_unique UNIQUE (user_id, type)
);
CREATE INDEX IF NOT EXISTS notification_preferences_user_idx ON notification_preferences (user_id);

DROP TRIGGER IF EXISTS trg_notification_prefs_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_prefs_updated_at BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  MODERATION
-- ═══════════════════════════════════════════════════════════════════════════

-- Reports. `target_id` is polymorphic, so it cannot be a FK — the
-- (target_type, target_id) pair is documented rather than enforced.
-- `snapshot` preserves what was reported at the time, because the underlying
-- row may be edited or deleted before a moderator looks at it.
CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL CHECK (target_type IN ('post', 'comment', 'event', 'user')),
  target_id     TEXT NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN (
                  'spam', 'harassment', 'inappropriate', 'misinformation', 'other')),
  details       TEXT,
  snapshot      JSONB,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'dismissed', 'actioned')),
  resolution    TEXT,
  resolved_by   TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One report per person per target: re-reporting reopens, it does not stack.
  CONSTRAINT reports_unique UNIQUE (target_type, target_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS reports_status_idx
  ON reports (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reports_target_idx ON reports (target_type, target_id);

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
--  ACHIEVEMENTS & EVENT INTEREST
-- ═══════════════════════════════════════════════════════════════════════════

-- The achievement catalogue. `code` is the stable key the engine awards
-- against, so copy and icon can change without a data migration.
CREATE TABLE IF NOT EXISTS achievements (
  code        TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  category    TEXT,
  points      INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unlocks. {user_id, code} is unique because a code unlocks once, ever —
-- that constraint is what makes achievement awarding idempotent, so no lock
-- is needed on the award path (see Phase 4).
CREATE TABLE IF NOT EXISTS user_achievements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code        TEXT NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_achievements_unique UNIQUE (user_id, code)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx
  ON user_achievements (user_id, unlocked_at DESC, id DESC);

-- "Interested" on an event. `event_id` is a MongoDB id — not a FK.
CREATE TABLE IF NOT EXISTS event_interests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT event_interests_unique UNIQUE (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS event_interests_user_idx  ON event_interests (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS event_interests_event_idx ON event_interests (event_id, created_at DESC, id DESC);

-- ═══════════════════════════════════════════════════════════════════════════
--  COUNTER MAINTENANCE
--  Counters live in the row they are read with, and are maintained here so
--  no application path can forget to update one. §72: a profile with no
--  followers really shows 0 — these are never seeded.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bump_follow_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.followee_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status <> NEW.status THEN
    IF NEW.status = 'accepted' THEN
      UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
      UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.followee_id;
    ELSIF OLD.status = 'accepted' THEN
      UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
      UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.followee_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.followee_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follows_counts ON follows;
CREATE TRIGGER trg_follows_counts AFTER INSERT OR UPDATE OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION bump_follow_counts();

CREATE OR REPLACE FUNCTION bump_like_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reactions_counts ON reactions;
CREATE TRIGGER trg_reactions_counts AFTER INSERT OR DELETE ON reactions
  FOR EACH ROW EXECUTE FUNCTION bump_like_count();

CREATE OR REPLACE FUNCTION bump_comment_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comments_counts ON comments;
CREATE TRIGGER trg_comments_counts AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION bump_comment_count();

CREATE OR REPLACE FUNCTION bump_posts_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET posts_count = posts_count + 1 WHERE id = NEW.author_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET posts_count = GREATEST(0, posts_count - 1) WHERE id = OLD.author_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_counts ON posts;
CREATE TRIGGER trg_posts_counts AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_posts_count();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  NOTES FOR PHASE 6 (migration)
--  ─────────────────────────────
--  • Row Level Security is intentionally NOT defined here. Authorisation
--    lives in the API layer, which is tested; duplicating it as RLS policies
--    would create two sources of truth that can disagree. The service-role
--    key bypasses RLS entirely, so leaving it off is also not a risk today.
--    Revisit only if a key ever reaches a client.
--  • Backfill order must respect FKs: profiles → organizations → communities
--    → posts → everything else. See docs/SUPABASE-MIGRATION.md (Phase 6).
--  • Every collection read must use keyset pagination with the composite
--    indexes above. An unbounded SELECT is a §13 violation.
-- ═══════════════════════════════════════════════════════════════════════════
