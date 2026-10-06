# EVENTHUB — PART 4 PHASE PLAN
## Real-Time Live Event Engine

> Derived from the Part 4 spec (100 sections). Every section maps to exactly one phase below.
> Standing constraints from Parts 1–3 carry forward: server-side-only enforcement, no synthetic data, static verification battery (sandbox prohibits installs/builds), permanent super admin `devanshsinghr00@gmail.com`.

---

## Pre-Plan Audit Findings (this session)

| Finding | Consequence |
|---|---|
| **Socket.IO does NOT exist** — absent from both package.json files, node_modules empty | Spec assumes existing Socket.IO; none is present. Phase 0 **adds `socket.io` (backend) + `socket.io-client` (frontend) as the single realtime framework** (spec §1: "do not introduce a second realtime framework"). Deps install at deploy; sandbox verification stays static. |
| Existing quiz system (Part 2 §G) is **HTTP + polling** (`quiz.model.js`, `quizParticipation.model.js`, submitAnswer POST) | Coexists untouched. The new **Activity Engine** becomes THE live path; old quiz endpoints remain for backward compat. Bridge noted in Phase 1. |
| Event model has only a date-based `isLive` virtual — no state machine, no join code | Phase 1 adds `liveState` enum + `joinCode` + `liveSettings`. |
| Framer Motion already in frontend stack (Part 1) | Bubble/leaderboard animations use existing dep — no new frontend packages. |

---

## Phase 0 — Realtime Foundation & Protocol  *(spec §1, 68, 79–81, 90–92)*
- Add `socket.io` / `socket.io-client` to package.json (only new dependency in Part 4)
- `server.js`: create HTTP server, attach Socket.IO, export `io` (single instance)
- **`config/socket-protocol.js`** — ONE central protocol definition: every client→server, organizer→server, server→client event name + payload shape + role. No event names invented elsewhere.
- **Socket auth middleware**: identity from JWT handshake (never client-sent userId), room-join authorization, structured errors `{code, message}` — no stack traces
- Multi-event isolation + organizer isolation design (every command verifies event ownership)
- Scalability note: in-memory room registry now, Redis adapter slot later (§90)

## Phase 1 — Activity Engine Data Layer + Builders  *(§13–14, 19–26, 70–71, 74–77)*
- Event model: `liveState` machine (DRAFT → PUBLISHED → REGISTRATION_OPEN → REGISTRATION_CLOSED → CHECK_IN → WAITING → LIVE → PAUSED → COMPLETED | CANCELLED), `joinCode`, `liveSettings` (late join, require registration/check-in, leaderboard visibility+interval, answer changes, chat/Q&A/polls toggles, team mode, scoring config: base / speed bonus / negative / partial / weighting)
- **`Activity` model** — generic: type enum (QUIZ, POLL, QA, LEADERBOARD, WELCOME, …), order, state (UPCOMING/READY/LIVE/PAUSED/COMPLETED), per-type config. Quiz is one activity type (spec's final principle)
- **`Question` model**: 6 types (MULTIPLE_CHOICE, SINGLE_CHOICE, MULTI_SELECT, TRUE_FALSE, SHORT_ANSWER, LONG_ANSWER), media (Cloudinary), `correctAnswer` server-only (never selected in participant projections), points, timeLimit, order, explanation
- Session/persistence models: `ParticipantSession`, `LiveAnswer` (unique index = idempotency), `PollResponse`, `QAQuestion`, `LiveMessage`, `EventResult` (immutable snapshot)
- Quiz **validation service** — malformed quizzes can never go live
- `QuizGeneratorService` **architecture boundary only** (provider-agnostic input/output; actual AI later)
- Frontend: **Activity Builder** (sequence, reorder) + **Quiz Builder v2** (question editor: type, image, add/remove/mark options, points, timeLimit, duplicate, delete, reorder, participant preview mobile/desktop)
- Persistence discipline (§70–71): persistent = identity/registration/scores/answers/results; volatile = memory only

## Phase 2 — Realtime Core: Rooms, Join, Presence, Waiting Room, Reconnect  *(§2–12, 45, 49–54, 78, 93–94)*
- Rooms: `event:{eventId}` + `event:{eventId}:activity:{activityId}` — strict isolation
- **Server-side join validation chain**: exists / accessible / registration / visibility / eligibility / not ended / session — client input never trusted
- In-memory presence (Connected, Disconnected, Reconnecting, Joined, Ready, Active, Completed) — no Mongo writes for volatile state; duplicate-connection policy = one logical participant (no double count)
- **`GET /api/events/:id/live/state`** — role-scoped (participant vs organizer payloads)
- **Reconnect protocol**: reauth → rejoin → full state resync (activity, remaining time, answered-ness, score/rank). Quiz never restarts.
- Late joiners per config; join via QR / link / join code; **QR = safe URL only, no tokens**
- Participant counts shown separately: registered / checked-in / connected
- **Waiting room**: participant screen ("You're in", count, animated avatar bubbles — framer-motion, virtualized cap + "+N" overflow, public identity only); organizer screen (connected/ready counts, search, list, QR, prominent Start); "I'm ready" flow (247/250 ready — non-blocking)

## Phase 3 — Organizer Command Center + Event Lifecycle  *(§15, 44, 57, 92)*
- Every command server-authorized (owner / admin / authorized moderator — organizer A can never touch event B)
- Commands: event start / pause / resume / **end (confirm)**; activity start / pause / resume / end / next / previous; leaderboard show / hide
- Event end finalization: state → COMPLETED, stop activity, stop answers, finalize scores + leaderboard, broadcast `event:completed`
- **Command center layout**: TOP (event, LIVE, participant count, End) · LEFT (activity list) · CENTER (current activity, question, timer) · RIGHT (participants, chat) · BOTTOM (prev / pause / next / leaderboard)

## Phase 4 — Quiz Engine Live: Timer Sync, Delivery, Answers, Server Scoring  *(§16–18, 22–23, 27–30, 53, 55–56, 67, 69)*
- **Clock synchronization**: serverTime on connect → client offset → countdown from `activityStartedAt + duration` (client never source of truth; wrong device clocks harmless)
- Timer UI: Normal / Warning / Critical — restrained
- **Sanitized question delivery**: questionId, text, options, media, points, timeLimit, server timestamp — **correctAnswer NEVER leaves the server for participants** (projection guard)
- Answer flow: full server validation (in event, activity live, question active, not already answered, format valid) + **idempotency** + rate limiting
- **Server-authoritative scoring engine**: configurable base points, speed bonus, negative marking, partial scoring, question weighting; `answeredAt` + `responseTime` stored
- Late answers rejected by server timer; pause stops clock, resume recalculates remaining
- Anti-cheat basics (§67): server scoring/timer, one answer per question, auth, rate limits, timestamps, duplicate-session detection

## Phase 5 — Leaderboard Engine  *(§31–38, 88–89)*
- Answer → server scores → re-rank → `leaderboard:update` broadcast (full payload for MVP; architecture delta-ready)
- Entry: rank, participantId, displayName, avatar, score, **previousRank, rankChange** (+team)
- Framer-motion row movement with **stable keys** (no flash re-render)
- Podium: gold / silver / bronze — elegant, not cheesy
- Display modes (config): Never / every question / every N / after activity / checkpoints / final only
- Participant view (rank, score, top players, full leaderboard) + organizer view (search, correct answers, avg response time, rank change)
- **Team mode foundation**: score owner = participant OR team per activity config (single scoring engine, not duplicated)

## Phase 6 — Poll + Q&A + Live Chat + Transitions  *(§39–43, 69)*
- **POLL**: vote → live percentages; individual votes hidden unless configured
- **Q&A**: submit, upvote; organizer: Feature / Answer / Hide / Close
- **Live chat**: rate-limited; organizer/moderator delete / mute / pin
- **Activity switcher + transitions**: `activity:starting` → animated transition, NO page reload; participants see "Next activity starting…"

## Phase 7 — Projector Mode, Announcements, Connection UI, A11y, Layouts  *(§45–48, 82–87, 93–94)*
- **`/events/[slug]/live/display`** — projector mode: huge typography, high contrast, minimal UI, large timer, question, leaderboard, QR (before + during per config), zero participant controls, zero private info
- Live announcements → temporary banner broadcast
- Connection state UI: Connected / "Connection lost. Reconnecting…" — no instant kick, local state preserved, sync on reconnect, stale answers never blindly submitted
- All 9 UI states intentional: PRE-LIVE, WAITING, LIVE, PAUSED, TRANSITION, LEADERBOARD, COMPLETED, ERROR, RECONNECTING
- Accessibility: keyboard options, visible focus, SR labels, color never the only correct/incorrect signal
- Mobile one-hand layout + desktop centered layout (optional leaderboard side panel)

## Phase 8 — Event Completion: Results, Snapshot, Analytics  *(§58–59, 64–66, 72–73)*
- Final results screen: score, rank, correct answers, accuracy, achievements, certificate availability, share
- Final leaderboard + podium + current participant highlighted
- **Immutable `EventResult` snapshot** (event, participants, scores, ranks, activities, summary) — source for leaderboard/certificates/analytics/memories
- **Question analytics**: total answers, correct %, option distribution (A 12% / B 8% / C 74% / D 6%), avg response time
- **Activity analytics**: participants, completion, avg score, engagement, drop-off — real data only
- Organizer results: totals, completion rate, avg score, top participants, export
- Realtime logging discipline (§72): persist business events (answer submitted, activity completed, event completed) — never socket noise

## Phase 9 — Completion Hooks: Certificates, Achievements, Event Memory, Social Loop  *(§60–63)*
- `EventCompleted` → **CertificateService** hook (generation request foundation — no designer yet)
- Live-event achievements (First Event, Quiz Winner, Top 3, Top 10, Participant) — extends Part 3's extensible achievement engine
- **Event memory page**: "You were part of HackCraft 3.0" + stats (score, rank, questions, time, achievements)
- **Structured share-to-feed post**: poster, rank, score, achievements, editable caption → Part 3 social feed

## Phase 10 — Tests, Load Foundation, Demo Mode, Build Verification  *(§95–99)*
- Test scenarios: two participants join · wrong event · unauthorized organizer command · start event · start activity · answer · **duplicate answer** · **timer expiration** · pause · resume · leaderboard update · poll vote · Q&A submission · chat · disconnect · **reconnect** · late join · end event · final results
- Load foundation: 10 and 50 simulated clients (where practical in sandbox)
- **DEV-only demo mode** — env-gated, never production, clearly labeled fixtures
- Full verification battery: node --check + balance/symbol sweeps; frontend lint/typecheck/build + backend tests where sandbox allows (install ban noted); fix all critical errors
- End-to-end demo flow verification (§97)

## Phase 11 — Final Report  *(§100)*
- **# EVENTHUB PART 4 COMPLETE** — all required sections (Live Engine, Realtime Architecture, Socket Events, State Machine, Activity Engine, Quiz, Polls, Q&A, Chat, Leaderboard, Organizer Controls, Projector Mode, Reconnection, Security, Persistence, Certificate/Achievement Hooks, Event Memory Hook, Tests, Mock Data, Build Status) with **PASS/FAIL per area** + demo-flow confirmation

---

## Coverage Map (spec § → phase)
§1→P0 · §2–12→P2 · §13–14→P1 · §15→P3 · §16–18→P4 · §19–26→P1 · §27–30→P4 · §31–38→P5 · §39–43→P6 · §44→P3 · §45→P2/P7 · §46–48→P7 · §49–54→P2 · §55–56→P4 · §57→P3 · §58–59→P8 · §60–63→P9 · §64–66→P8 · §67→P4 · §68→P0/P3/P4 · §69→P4/P6 · §70–73→P1/P8 · §74→P1 · §75–77→P1 · §78→P2 · §79–81→P0 · §82–87→P7 · §88–89→P5/P7 · §90–92→P0/P2/P3 · §93–94→P7 · §95–99→P10 · §100→P11 — **all 100 sections mapped**

## Hard Rules Enforced Across All Phases
1. **No fake realtime** — no setInterval-driven state, no random numbers, no synthetic participants/leaderboard movement (spec "IMPORTANT")
2. **Server is authoritative** — scores, ranks, timers, correctness, eligibility; client only renders
3. **Answer keys never reach participants**
4. **One realtime framework** — Socket.IO only, added in Phase 0
5. **Multi-event + organizer isolation** on every room join and command
6. **Volatile presence in memory; business events in Mongo**
