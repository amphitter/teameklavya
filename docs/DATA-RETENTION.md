# Data retention (Part 5, Phase 8 — spec §53, §54)

What EventHub keeps, what it disposes of, and how each temporary record is
retained or removed. Most cleanup is an explicit, bounded sweep; the only TTL
index is narrowly scoped to soft `seen` feed impressions.

---

## 1. The governing rule

> **Anything a person created, earned or was promised is permanent.
> Anything the system created to serve a moment is disposable.**

A user's event history, registrations, results and certificates are the product.
Deleting them to save space is not a tradeoff, it is data loss. Conversely,
one-time codes, abandoned uploads and transient room chatter have no value past
their moment and should not accumulate forever.

---

## 2. Classification

### PERMANENT — never auto-deleted

No script, index or scheduled job removes these. Deletion is a deliberate
user or admin action only (delete post, delete account, event takedown).

| Collection | What it is | Why permanent |
|---|---|---|
| `users` | Accounts | The root identity; everything references it |
| `events` | Events | The core product entity |
| `posts` | Feed posts, memories | User-authored content |
| `comments` | Comments | User-authored content |
| `reactions` | Likes | User-authored signal (§72 — real, never fabricated) |
| `saves` | Bookmarks | User intent |
| `registrationresponses` | Event registrations | A promise to attend; RSVP record |
| `tickets` | Check-in tickets | Attendance proof |
| `eventresults` | Immutable result snapshots | §73 — certificates and analytics read these |
| `certificates` | Issued certificates | A credential a person earned |
| `communities` / `communitymembers` | Communities + membership | User-organized groups |
| `communityclaims` | Ownership claims | Legal-ish record of a claim |
| `organizations` / `orgfollows` | Orgs + follows | User/organizer identity |
| `follows` | Social graph | User relationships |
| `conversations` / `messages` | Direct messages | Private user correspondence |
| `notifications` | Notification history | User-visible history |
| `blocks` | User blocks | Safety state |
| `reports` | Moderation reports | Safety record |
| `auditlogs` | Ownership/verification audit trail | Compliance; immutable by design |
| `quizzes` / `questions` / `activities` | Event content | Authored by organizers |
| `liveanswers` | Scored quiz answers | Feeds results |
| `participantsessions` | Live session + score | Feeds results and reconnect |
| `quizparticipations` | Quiz participation | Feeds results |
| `userachievements` | Earned achievements | A credential |
| `eventinterests` | "Interested" signals | User intent (§72 — real) |
| `registrationforms` | Custom form definitions | Organizer-authored |
| `pollresponses` | Poll votes | Feeds poll results |

### TEMPORARY — disposable, with an explicit mechanism

| Data | Mechanism | Default |
|---|---|---|
| Email-verify / reset-OTP / password-reset **fields** on `users` | `retention-sweeper.js --section=tokens` — `$unset` of the field pairs | Cleared when past their own expiry |
| `mediaassets` in `pending` / `cleanup_pending` | `media-sweeper.js` (Phase 4) — deletes record **and** remote object | Reclaimed after a 24 h grace |
| `livemessages` (live chat) | `retention-sweeper.js --section=live` | **Kept forever unless** `RETENTION_LIVE_ARCHIVE_DAYS` is set |
| `qaquestions` (Q&A) | same | same |
| `communications` / `communicationdeliveries` | `retention-sweeper.js --section=communications` — delivery rows are deleted before their campaign rows | Fixed 90 days; run daily |
| `postimpressions` with `kind: "seen"` | Partial MongoDB TTL index on `at` | 30 days by default (`POST_SEEN_TTL_DAYS`); `dismissed` rows are excluded and permanent |
| `registrationresponses.rsvpVerificationExpires` | Field value, cleared with the RSVP flow | n/a |

Communication history stores the campaign subject/scope and each recipient email,
delivery status and timestamp; it never stores the message body. Its 90-day
window is a product requirement, not an opt-in flag.

---

## 3. Running retention

```bash
# Always start with a dry run — it is the default, and changes nothing.
npm run retention:sweep

# Commit the token sweep only
node scripts/retention-sweeper.js --section=tokens --apply

# Machine-readable, for a cron job's log
node scripts/retention-sweeper.js --json

# Preview old communication history without changing it
node scripts/retention-sweeper.js --section=communications

# Remove communication campaigns and their recipient rows past 90 days
node scripts/retention-sweeper.js --section=communications --apply

# Reclaim abandoned uploads (separate tool — deletes the remote file too)
npm run media:sweep            # dry run
npm run media:sweep:apply
```

Suggested schedule (cron, or your platform's scheduler):

```cron
# Clear expired one-time codes nightly
17 3 * * *  cd /app && node scripts/retention-sweeper.js --section=tokens --apply --json >> /var/log/eh-retention.log

# Enforce the 90-day communications-history window nightly
37 3 * * *  cd /app && node scripts/retention-sweeper.js --section=communications --apply --json >> /var/log/eh-retention.log

# Reclaim abandoned uploads nightly, an hour later
17 4 * * *  cd /app && node scripts/media-sweeper.js --apply >> /var/log/eh-media.log
```

Both are idempotent and safe to re-run. Both default to a dry run, so a missing
`--apply` can never destroy data.

---

## 4. TTL indexes are tightly scoped

§53 says "TTL indexes only on temporary classes." A MongoDB TTL index deletes
the **entire document** when the indexed date passes; it cannot clear a field.
EventHub has one partial TTL index for the explicitly temporary `seen`
impression signal. All other cleanup here is explicit so dangerous records
survive and related communication rows are deleted together.

### `users` — would delete accounts

`users` carries `emailVerifyExpires`, `resetOtpExpires` and
`passwordResetTokenExpires`. A TTL index on any of them means:

> A user requests a password reset, gets distracted, and **their account is
> deleted** when the code expires 15 minutes later.

This is the single most dangerous misconfiguration available in this schema,
and it would surface in production weeks later as unexplained account
disappearances. Expiry must clear the *fields*, which is what
`retention-sweeper.js` does with `$unset` — an operation that structurally
cannot remove a document.

### `mediaassets` — would orphan remote files

Each record points at an object in Cloudinary or R2. A TTL index deletes the
*record* and leaves the *object*: an orphan that keeps consuming storage and
Cloudinary credits with nothing left in the database to reference it, so no
sweeper can ever find it again. Reclamation has to remove record and object
together, which is precisely what `media-sweeper.js` does (§55).

### `postimpressions` — only soft `seen` signals expire

A partial TTL index removes rows where `kind: "seen"` after
`POST_SEEN_TTL_DAYS` (30 days by default). Explicit `dismissed` rows are not
matched by the partial index and remain permanent; a deliberate exclusion is
not a soft, expiring signal.

### `communications` / `communicationdeliveries` — paired cleanup

These collections contain campaign subjects and recipient email/status snapshots,
not user-authored content or message bodies. The product retention window is 90
days. The sweeper deletes delivery rows first and then the campaign rows, in a
bounded, repeatable run; a database TTL index is intentionally not used.

### `livemessages` / `qaquestions` — a policy judgement, not a technical one

These are transient in nature, but "transient" is a decision an organizer
should make. A conference may legitimately want its Q&A preserved. So archival
is opt-in via `RETENTION_LIVE_ARCHIVE_DAYS`; unset means keep. A TTL index
cannot express "ask first".

Importantly, `EventResult` snapshots are immutable and stored separately, so
archiving live chat and Q&A can never invalidate a certificate.

### If a genuinely temporary collection is added later

It should get a TTL index — that is the right tool for a collection whose every
document is disposable (a dedicated `verificationtokens` collection, for
instance). The test is: *would deleting this entire document surprise anyone?*
If no, TTL is correct and cheap.

---

## 5. User-initiated deletion

Retention policy governs *automatic* disposal. It says nothing about a user
deleting their own content, which remains available at any time:

- **Posts** are soft-deleted (`status: "deleted"`) — the row survives for
  moderation and audit (§56) but vanishes from every feed, list and query.
  Profile post counts exclude soft-deleted posts so a profile never advertises
  posts nobody can open.
- **Account deletion** cascades per the domain rules in the user controller.
- **Event takedown** (moderation) removes an event from detail and list views.

---

## 6. §72 — no synthetic data

Nothing in this document describes padding, seeding or fabrication. Retention
exists to bound real data, not to manage placeholders. Demo fixtures remain
double-gated behind `scripts/seed-demo.js` and are never counted as real
likes, followers, participants, views or storage usage.
