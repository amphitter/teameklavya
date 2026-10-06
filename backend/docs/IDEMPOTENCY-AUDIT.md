# Idempotency & Duplicate-Action Audit — Part 5, Phase 2 (§28)

**Scope:** every user-facing write endpoint, checked for duplicate-submission
safety (double-click, retry, reconnect replay). Verdict key:
✅ safe · 🔧 fixed in Phase 2 · 📋 client-side follow-up (Phase 5)

## 1. Hard backstop — unique compound indexes (all verified present)

| Collection | Unique index | Protects |
|---|---|---|
| RegistrationResponse | `{eventId, userId}` | double event registration |
| Follow | `{follower, followee}` | duplicate follow rows |
| Reaction | `{post, user}` | duplicate likes |
| Save | `{post, user}` | duplicate saves |
| EventInterest | `{event, user}` | duplicate interest toggles |
| OrgFollow, Block | follower/followee + blocker/blocked pairs | duplicate rows |
| CommunityMember | `{community, user}` | double join |
| CommunityClaim | one-per-user claim | duplicate claims |
| Certificate | `{event, user}` | duplicate certificates |
| ParticipantSession | `{event, user}` session identity | duplicate join sessions |
| LiveAnswer | `{session, question}` | duplicate quiz answers |
| PollResponse, QuizParticipation | per-user/per-question | duplicate votes/attempts |
| UserAchievement | `{user, achievement}` | duplicate achievement grants |
| Report | one-report-per-target | duplicate reports |

A second identical submission of any of the above cannot create a duplicate
row — it surfaces as Mongo `11000` → normalized **409 CONFLICT** by
`utils/app-error.js` (Phase 1).

## 2. Toggle endpoints (like / save / follow / interest) — double-click note

These are **state flips by design**: a rapid double-click *un-toggles* (net
effect: not liked). The unique index prevents duplicate *rows*, not double
*toggles* — that is intended behavior, not a bug.

- 🔧 Phase 2 adds loop caps on top (§27): `GUARD_FOLLOW_TOGGLE` 20/min on
  follow, `GUARD_INTERACT_TOGGLE` 20/min on like/save, SOCIAL bucket 30/min
  behind both — a scripted like/unlike or follow/unfollow storm is throttled
  with `RATE_LIMITED` + `Retry-After`.
- 📋 Phase 5: client disables the button while the request is in flight
  (proper single-toggle UX).

## 3. Create endpoints — new §28 protections

| Endpoint | Mechanism | Verdict |
|---|---|---|
| `POST /api/posts` | `Idempotency-Key` header / `clientRequestId` body → 409 on dup within 2-min window | 🔧 added (optional key; dormant until frontend sends it) |
| `POST /api/posts/:id/comments` | comment-flood guard 10/min + SOCIAL bucket | 🔧 added (flood cap) |
| `POST /api/registration/responses` | unique `{eventId,userId}` + `Idempotency-Key` window + EVENT bucket | ✅ index (hard) · 🔧 dedup + bucket added |
| `POST /api/communities` | create cooldown 3/hr per user | 🔧 added (§27 cooldown) |
| `POST /api/tickets/generate` | unique per event+user ticket logic + EVENT bucket | ✅ + 🔧 bucket |

## 4. Check-in / door scanning — `POST /api/tickets/scan` (verified this phase)

- Re-scan **entry** on an already checked-in ticket → `400 "Already checked in"`
  — **no side effect**, ticket returned for the door operator. ✅
- Re-scan **exit** → `400 "Already checked out"` guard before any write. ✅
- `entryLogs` is append-only and each entry records `scannedBy` + method +
  device, so audit history is preserved; duplicate *scans* are rejected,
  duplicate *log rows* cannot occur. ✅
- 🔧 `GUARD_TICKET_SCAN` 60/min added. **Documented deviation:** door
  scanning is legitimately rapid (a human operator scanning a queue), so this
  cap is deliberately generous — it exists to stop scripted abuse, not
  operators.

## 5. Realtime (§24) — reconnect & replay safety

Existing per-socket cooldowns (join 1.2 s, answer 400 ms, command 250 ms)
are unchanged. Phase 2 adds the cross-socket dimension:

| Guard | Cap | Purpose |
|---|---|---|
| connect per user | 10/min | reconnect storms |
| connect per IP | 30/min | multi-account socket floods |
| event join per user | 15/min | join/leave spam across sockets |
| answer per user | 60/min | multi-socket answer spam (never binds a fast quiz) |

Violations: connect → socket disconnected; join/answer → `S_ERROR` with
`RATE_LIMITED`. All counted in `rateLimit:*` metrics.

## 6. Coverage gaps closed (from Phase 0 audit §11)

| Gap | Fix |
|---|---|
| `/api/auth/google` routes mounted with **no** limiter | AUTH bucket now applies at the `/api/auth` **prefix** — covers both mounts |
| One shared 400/15m bucket for all of `/api` (a burst on any route throttled all browsing) | per-domain buckets; `/api` now READ 300/min (generous, §26) |
| 429s carried a non-standard body, no `Retry-After` | all 429s → `RATE_LIMITED` code + `Retry-After` seconds (§25) |
| Uploads: single 30/10m bucket | burst 15/10m **+** hourly session cap 10/hr (§23) |

## 7. Response contract (all 429s)

```json
{ "success": false, "message": "Too many requests. Please try again shortly.",
  "error": { "code": "RATE_LIMITED", "message": "Too many requests. Please try again shortly." } }
```

`Retry-After: <seconds>` header on every 429. No infrastructure details
(store type, bucket names, middleware identity) are ever exposed (§61/§64).

## 8. Frontend follow-ups (Phase 5 backlog)

- 📋 Send `Idempotency-Key` (uuid) on post create + registration submit.
- 📋 Disable submit/like/follow buttons while their request is in flight.
- 📋 Toast on 429 respecting `Retry-After` (respectful retry UX).
