# Realtime hardening (Part 5, Phase 6 — spec §43, §44, §45)

The live engine is `backend/services/realtime.service.js`. This document is the
reference for its limits, its backpressure behaviour, and the path to running
more than one instance.

Standing rule throughout: **this stays a modular monolith.** No queue system, no
service split. Everything below is either in-process bookkeeping or documented
migration surface.

---

## 1. Connection caps (§43)

### Why two separate mechanisms

Phase 2 added **rate windows** (`REALTIME_CONNECT_USER`, `REALTIME_CONNECT_IP`):
how *often* a client may connect. Phase 6 adds **concurrency caps**: how many
sockets may exist *at once*.

They are not redundant. A client that reconnects every 8 seconds never trips a
per-minute rate window, yet it accumulates sockets without bound — and every
socket is memory plus event-loop work on a single small instance. Rate limits
answer "are you spamming me?"; caps answer "how much are you holding?".

### The ceilings

| Cap | Default | Env override |
|---|---|---|
| Sockets per user | 5 | `REALTIME_CAP_SOCKETS_PER_USER` |
| Sockets per IP | 20 | `REALTIME_CAP_SOCKETS_PER_IP` |
| Participants per event room | 500 | `REALTIME_CAP_PARTICIPANTS_PER_ROOM` |
| Idle room TTL | 30 min | `REALTIME_CAP_IDLE_ROOM_TTL_MS` |
| Sweep interval | 5 min | `REALTIME_CAP_SWEEP_INTERVAL_MS` |

Defined in `config/rate-limits.js` as `REALTIME_CAPS`, deliberately **outside**
the `LIMITS` table — that table is iterated into `{limit, windowMs}` limiter
configs, and these are plain counts.

Per-IP is intentionally larger than per-user: a classroom, office or carrier NAT
legitimately shares one address. It is bounded rather than unlimited so a single
NAT cannot occupy every slot.

### Enforcement

Both ceilings are checked in `io.on("connection")`, after the Phase 2 rate
windows and before `registerHandlers`. A refused socket receives a structured
`TOO_MANY_CONNECTIONS` error **before** being closed, so the client can tell the
user "close another tab" instead of showing a generic slow-down.

`TOO_MANY_CONNECTIONS` and `ROOM_FULL` are distinct from `RATE_LIMITED` on
purpose. Collapsing them into one code would leave the client unable to explain
what the user should actually do.

**Room caps count distinct participants, not sockets.** A user already in the
room can always re-join from another tab — nobody can lock themselves out by
reconnecting, which is the failure mode a naive `size >= cap` check produces.

### The registry

`connectionRegistry` (exported from the service) is the bookkeeping:

- `bySocket: socketId → { userId, ip, connectedAt }`
- `byUser: userId → Set<socketId>`
- `byIp: ip → Set<socketId>`

It exists separately from the `rooms` map because the two answer different
questions. `rooms` is keyed by event and tracks one user's sockets *within that
event*; the per-user and per-IP caps are global — a user's five tabs span
events, and a NAT'd IP's phones span users. Neither number is derivable from
the other.

Entries are added on connect and removed on disconnect. Empty sets are deleted
rather than left to accumulate.

---

## 2. Stale-socket sweep (§43)

### The failure it fixes

A socket that dies without a clean `disconnect` — laptop lid, dead mobile radio,
force-killed tab, network partition — leaves a participant marked `"connected"`
forever. The presence map then drifts from reality: counts inflate, and a
participant who is long gone still occupies a room slot.

The authoritative answer to "is this socket alive?" is the transport. `Socket.IO`
maintains the connection; the registry mirrors it. **Anything in a room but
missing from the registry is by definition stale**, which is exactly what the
sweep removes.

### What it does

Runs every `REALTIME_CAP_SWEEP_INTERVAL_MS`, `unref()`'d so it never holds the
process open:

1. Drop socket ids the transport no longer knows about.
2. A participant whose last socket is gone → `state = "disconnected"`.
   **The entry is kept**, so a fast reconnect restores score, ready state and
   join time (§51). It is only dropped once idle past `IDLE_ROOM_TTL_MS`.
3. An organizer whose last socket is gone is dropped immediately — organizers
   carry no reconnect state.
4. A room with no participants and no organizers, idle past the TTL, is deleted.

The timer is exported as `startStaleSocketSweep` / `stopStaleSocketSweep` and
the sweep itself as `sweepStaleSockets()`, so tests drive it deterministically
instead of waiting on a wall clock.

Nothing here writes to MongoDB. Presence is volatile by design (§42).

---

## 3. Backpressure (§44)

### The rule

**Broadcasts are throttled. Correctness never is.**

A coalesced leaderboard refresh costs a participant nothing but a stale number
for a second. A coalesced answer costs them their points. The code order
reflects that: the score is persisted and acked to the participant *before* any
throttled broadcast is considered.

### Throttle inventory

| Channel | Window | Where |
|---|---|---|
| Leaderboard re-rank | 1 s | `room.lastBoardAt` |
| Poll distribution | 1 s | `room.lastPollAt` |
| Q&A list broadcast | 400 ms | `room.qaListAt` |
| Answer (per socket) | 400 ms | `socket.data.answerAt` |
| Organizer command | 250 ms | `socket.data.cmdAt` |
| Event join (per socket) | 1.2 s | `socket.data.joinAttemptAt` |

Plus the Phase 2 cross-socket `SlidingWindow` guards, which add the per-user and
per-IP dimension the per-socket cooldowns cannot see:
`REALTIME_CONNECT_USER`, `REALTIME_CONNECT_IP`, `REALTIME_JOIN`,
`REALTIME_ANSWER`.

### What is never coalesced

- **Answers.** Each accepted answer writes exactly one `LiveAnswer` and updates
  the session score immediately. A duplicate is rejected with
  `ALREADY_ANSWERED` rather than counted twice.
- **Personal results.** `answer:accepted` and the command ack carry the
  server-authoritative score, emitted before any board refresh.
- **Final results.** `event:end` builds the leaderboard from persisted
  `ParticipantSession` documents and writes an immutable `EventResult` snapshot.
  The board a participant sees at the end is recomputed from durable state, not
  replayed from throttled broadcasts.

Verified in `tests/phase6.selftest.js` §7: a correct answer scores 100 while the
board is throttled, and an immediate duplicate leaves the score at 100.

---

## 4. State reconstruction (§45)

A reconnect re-runs the same `event:join` path as a first join and returns the
full `stateForParticipant` payload: identity, my score/ready state, counts, the
participant preview, the open question (sanitized — no answer key), Q&A list and
chat state.

Two properties the tests pin:

1. **The open question survives a reconnect.** `currentActivityOf()` must include
   `questionRuntime` in its projection, because both state builders gate the
   question block on `activity.questionRuntime.questionId`. When the projection
   omitted it (a pre-existing bug found in Phase 5), a participant who
   reconnected mid-question received `question: null` and saw nothing until the
   next question opened. That regression is now asserted directly.
2. **Late joiners get the running activity** (§54) when
   `liveSettings.allowLateJoin !== false`.

---

## 5. Scaling out — the path, not the implementation

Today one process holds all realtime state in memory. That is the right call for
a free-tier monolith, and it is also the ceiling: **two instances would not share
presence.** A user connected to instance A is invisible to a user on instance B.

Nothing below is implemented. This is the migration surface the current design
keeps available.

### What breaks first, and why

| State | Today | Under N instances |
|---|---|---|
| Rooms / presence | in-memory `Map` | per-instance only — needs sharing |
| `ParticipantSession` | MongoDB | already shared, no change |
| Scores / results | MongoDB | already shared, no change |
| Rate windows + caps | in-process `SlidingWindow` | divide by N, or move to Redis |

The durable half (sessions, scores, results) is already multi-instance safe. Only
the volatile half is not — which is exactly why presence was kept out of MongoDB
(§42).

### Steps, in order

1. **Sticky sessions.** Socket.IO's long-polling fallback needs a client to stay
   on one instance; enable session affinity at the load balancer (Render,
   Nginx `ip_hash`, or `cookie`-based). Without this, deployments break before
   Redis helps.
2. **Redis adapter.** `@socket.io/redis-adapter` replaces the default in-memory
   adapter so `io.to(roomKey(eventId)).emit(...)` reaches sockets on every
   instance. Room *membership* is already a Socket.IO concern, so this is close
   to a drop-in.
3. **Move presence to Redis.** The `rooms` map becomes a Redis-backed structure
   keyed by event. This is the substantive change — `roomOf()`, `connectedCount`,
   `readyCount` and the sweep all assume synchronous local access and would need
   to become async.
4. **Move the limiters.** `SlidingWindow` is explicitly documented as
   *not* distributed. Swap the backing store for Redis `INCR` + `EXPIRE`, or
   divide limits by the instance count as a stopgap.
5. **Optional: Redis-backed queues.** §65 says do not introduce one now. When
   write bursts eventually warrant it, the service boundaries are already drawn:
   `services/` is organised by domain, so queue consumers attach behind the
   existing interfaces rather than cutting through them.

### What deliberately does NOT change

- No microservices. The live engine stays inside the monolith; Redis is a shared
  backing store, not a service boundary.
- Presence never becomes a MongoDB collection. Real-time noise in the database is
  exactly what §42 forbids.
- The event/room model and the wire protocol are unchanged, so clients need no
  modification when this happens.
