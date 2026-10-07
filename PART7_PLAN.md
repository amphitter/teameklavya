# PART 7 — PRODUCTION HARDENING, DATA CONSISTENCY, SECURITY & REAL-WORLD VALIDATION

Read `PART6_FINAL_REPORT.md` first. Part 7 changes nothing about the
architecture; it makes the existing architecture production-safe.

## Standing constraints (unchanged, non-negotiable)

- DO NOT rewrite EventHub · no microservices · no Kubernetes · no Kafka · no
  Elasticsearch
- DO NOT replace MongoDB · Upstash Redis · Supabase
- MongoDB = event/business source of truth
- Supabase = relational/social target
- Upstash Redis = shared ephemeral infrastructure
- EventHub API = single security/business boundary
- **No source deletion from Mongo. Ever. No CLI flag may exist for it.**
- Do not remove or weaken existing tests: **924 assertions, 6 e2e suites**

---

## Phase map

| # | Phase | Brief § | Status |
|---|---|---|---|
| 0 | Audit & plan | — | ✅ |
| 1 | Reconciliation service + script | §2, §3, §4, §6 | ✅ |
| 2 | Dead-letter system + migration safety | §5, §7 | ✅ |
| 3 | Real-provider test suite | §1 | ✅ |
| 4 | Security audits (Supabase, Redis, cache) | §8, §9, §11, §13 | ✅ |
| 5 | Community ownership & Super Admin protection | §10 | ✅ |
| 6 | Auth hardening, fuzzing, authorization matrix | §14, §15, §16, §17 | ✅ |
| 7 | Provider failure matrix + preflight | §12, §31 | ✅ |
| 8 | Observability, alerting, perf & query budgets | §23, §24, §25, §26 | ✅ |
| 9 | Load, horizontal scale, realtime readiness | §20, §21, §22 | ✅ |
| 10 | Error taxonomy | §30 | ✅ |
| 11 | Frontend + upload + rate-limit review | §27, §28, §29 | ✅ |
| 12 | Restore drill, backups, secret separation | §18, §19 | ✅ |
| 13 | Documentation set | §32 | ✅ |
| 14 | Final report | §33 | pending |

### Phase 3 — RESULT: ✅ **DONE** (`tests/real-providers.selftest.js`)

Every other suite drives fakes. A fake encodes OUR UNDERSTANDING of a provider,
not the provider's behaviour — it cannot tell us the Upstash pipeline argument
order is wrong, that a live column is spelled differently, that an assumed
Postgres constraint was never created, or that a trigger counter does not
increment the way we think. Only the real thing can.

**Gating (§1: never auto-run in CI).** Exits 0 immediately unless
`REAL_PROVIDER_TESTS === "true"`; exits 0 if any of the four credentials is
missing. `npm run test:real-providers` is deliberately **NOT** in `test:all`.

**Credential hygiene.** Every printed line passes through `redact()`, and the
run ENDS by asserting no secret value appears in anything captured. The
assertion is the point — a promise not to leak that is never checked is broken
by the next error message someone adds.

**Isolation.** All keys live under `eh_realtest:<runId>:`, so cleanup can
scan-and-delete the namespace without touching a production key. `flush()`
(drops the whole DB) is never called.

**Covers:** Redis PING/SET/GET/PTTL/SET-NX/expiry · the Lua sliding-window
limiter (limit, over-limit, roll-over, single atomic script) · distributed
idempotency (refuse, release, TTL) · distributed lock (unpredictable token,
contention, **non-owner cannot release**, owner can, expiry recovers) ·
namespace isolation · Supabase INSERT/UPDATE/UPSERT/pagination/termination ·
NOT NULL · invalid enum · FK rejection · trigger counter increment · outbox
application twice without duplication · reconciliation twice with zero repairs
on the second run (needs `MONGODB_URI`).

**Three bugs found and fixed by running it against unreachable endpoints:**
1. `supabaseProvider().health()` **never throws** — it returns `{ok:false}`.
   Checking only for a throw gave a FALSE PASS against a Supabase that was not
   reachable at all. Now checked by return value.
2. An uncaught throw in the pagination section aborted the whole run, so
   cleanup and the credential-leak assertion never executed. The Supabase
   section is now a guarded function; §8 and §9 moved into `finalChecks()`,
   which runs on both the normal and the crash path.
3. A run where every test was skipped still exited 0 — a broken environment
   masquerading as a green suite. Now exits 1 when `passed === 0`.

**Skipped is never green.** Skips are counted separately, reported with their
reason, and the summary warns that they are not passes.

Regression: **997 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 4 — RESULT: ✅ **DONE** (`tests/phase12.selftest.js`, 56 assertions) + `docs/SECURITY-MODEL.md`

These four sections are all one question asked at different layers: **can a
value reach someone it does not belong to?** §13 a cached value served to the
wrong principal · §11 a Redis key collided with or read by the wrong path ·
§8 a Supabase credential or raw error reaching the wrong audience · §9 a
browser reaching Supabase directly.

**§13 — five privacy classes, not two.** Part 6 drew the line at
public|private. Enough to decide SWR, not enough to answer *whose data is
this, and how bad is it if it leaks* — a leaked TRENDING list is a bug, a
leaked FEED is a breach. Added `CACHE_PRIVACY` / `DOMAIN_PRIVACY`; every
domain the `keys` builder can emit must be classified, and `privacy` is now
DERIVED from that table so registry and classification cannot drift.

**Three real findings while building it:**
1. The registry declared **14 domains while the builder could emit 23**. The
   nine undeclared ones (slugs, counters, unread counts) had no stated owner,
   TTL or invalidation — nobody had decided. All 23 declared now.
2. Dropping the legacy `user` domain from `PRIVATE_DOMAINS` **weakened the SWR
   guard**: keys written by older builds still exist in a live Redis and are
   still readable, so a domain leaving the private list silently makes them
   SWR-eligible. Privacy rules must cover the data that is out there, not just
   the data this build writes. `user` retained, with the reason recorded.
3. Two phase10 assertions passed **vacuously** — `UNREAD_MESSAGES` and
   `UNREAD_NOTIFICATIONS` had no builder in the test's map, so the loop
   short-circuited to `true`. Both now checked for real.

**Two of my own tests were wrong, not the code.** The DSN-scrub check
pattern-matched the source text and missed (the regex uses `postgres(?:ql)?`,
so the literal `postgres://` never appears), and `assertConfigured` was looked
for in `client.js` when it lives in `index.js`. Fixed by exporting `__scrub`
and testing its **behaviour** — a source-pattern test keeps passing even if the
function stops being called.

**§9 — RLS is OFF, deliberately, and now argued in writing** in
`docs/SECURITY-MODEL.md`: the service-role key bypasses RLS entirely, so
enabling it would buy nothing while duplicating authorisation into SQL where
it would drift from the tested API layer. It becomes **mandatory** the moment a
browser→Supabase path appears. No half-configured RLS: enabled-with-no-policy
denies everything, so a migration "succeeds" having written nothing.

**§11** — every `SET` carries PX · no credential logged or in a key · DSN/JWT
scrubbing · no controller constructs a key · prefix isolation (`event` vs
`event-counts`) · lock tokens are UUIDs, release is compare-and-delete, expiry
recovers.

Regression: 999 → **1055 assertions, 0 failed** (924 floor held); 6/6 e2e.
phase10 went 363 → 365 (2 assertions strengthened, none weakened).

### Phase 5 — RESULT: ✅ **DONE** (`services/ownership.service.js`, 35 new assertions)

**The finding that drove this phase:** the permanent Super Admin was already
protected — but in **five places that each re-derived the address by hand**:

```js
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "...").toLowerCase();
```

They agreed by coincidence. The first one to be edited would have become
either a hole (protecting the wrong address) or a lockout (protecting a stale
one). A security rule that holds by coincidence is not a security rule.

`services/ownership.service.js` is now the single definition. The middleware
re-exports it, so every existing caller is unchanged, and a test asserts no
other module reads `process.env.SUPER_ADMIN_EMAIL`.

**A second suspension path was found.** `suspendUser()` was guarded, but the
report-resolution flow (`action === "suspend_user"`) suspended users too and
had its own copy of the rule. Guarding one path is how this rule stops
holding. Both now call the same guard, and the test asserts the guard appears
at least twice in that controller.

**UNDIMINISHABLE BY CONSTRUCTION (§10 undemotable).** Super Admin authority is
derived from an email CONSTANT, not from the stored `role` field. So there is
no flag to flip: a user with the address has the authority even if their
`role` is `'user'`. Asserted directly. The trade-off is deliberate — a role
field is editable, a constant is not, and for a permanent owner we want rigid.

**Verified:** UNDELETABLE (no controller deletes a User; both suspension paths
guarded) · UNDEMOTABLE (derived; no controller assigns a platform role) ·
UNTRANSFERABLE (no controller or service writes the constant, so status cannot
be granted; the transfer guard is belt-and-braces behind `requireSuperAdmin`).

**Institutional email is affiliation, never ownership.** `isInstitutionOwned()`
returns `false` unconditionally and exists so the rule is sayable in code
rather than a convention nobody can discover. Ownership resolves from what the
platform RECORDED (`createdBy`, then an *active* admin member) — never from an
email domain. A pending admin does not confer ownership.

**One deliberate exception:** the owner may act on themselves. Refusing
self-service would lock them out of their own property, which is the opposite
of what §10 protects. `guardSuperAdmin` reports the block and the caller
decides; `isSelfAction` is the exemption.

Regression: 1055 → **1090 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 6 — RESULT: ✅ **DONE** (`tests/phase13.selftest.js`, 35 assertions)

Boots the REAL server against in-memory Mongo and attacks it over HTTP.

**§15 — the auth model is bearer-token, not cookie-based.** An earlier draft of
`docs/SECURITY-MODEL.md` described an HttpOnly/Secure/SameSite cookie model.
That was wrong: the API sets **no cookies at all** — login returns a JWT in the
body and `requireAuth` reads `Authorization: Bearer`. A security document
describing controls that do not exist is worse than no document, so §6 of the
doc now states the real model and the test asserts it by observation (no
`set-cookie` on login) rather than by comment.

**CSRF is therefore not implemented, and should not be** — §15's rule is that
CSRF applies only where cookie auth applies, and a bearer token is not attached
automatically by the browser. The condition is recorded: if a session cookie is
ever introduced, CSRF becomes mandatory at the same moment.

**Four real server bugs found by fuzzing (all fixed):**
1. `getPostById` — a malformed ObjectId threw a `CastError` that the generic
   `catch` turned into a **500**. Three consequences: a client mistake reported
   as an outage (polluting alerting), a retry hint on a request that can never
   succeed, and a clean oracle for "which inputs reach Mongo unvalidated".
   Now validated up front, with unexpected errors routed through `next()` so
   the central taxonomy decides the status.
2. `getFollowStatus` — the identical pattern, fixed the same way.
3. `createOrganization` — a 200 000-character name produced a 200 000-character
   slug, and `exists({slug})` then exceeded Mongo's ~1024-byte index key limit
   and threw, again as a 500. Name now bounded to 100 chars, slug to 80.
4. All three controllers flattened every failure to 500. They now call
   `next(error)` so a duplicate key is 409 and a validation error is 400.

**Two bugs in my own harness, worth recording:**
- **Port 5061 is on the WHATWG fetch spec's BLOCKED PORT list** (it is `sips`).
  undici refused to connect, every request returned `status 0`, and my
  assertions "passed" against a value that meant *the request never happened*.
  A test that cannot fail is not a test. Moved to 5099.
- The helper discarded `rawBody` whenever `body` was undefined, so the
  malformed-JSON and oversized-payload probes sent **no body at all** and were
  measuring a 403 from the auth middleware. Both now exercise body-parser.
- Several probes also used routes that do not exist (`/users/me`,
  `/admin/overview`) and were measuring 404s. Replaced with real routes.

**Coverage:** 84 malformed-ObjectId probes · 88 hostile-body probes
(deep JSON, huge strings/arrays, prototype pollution via `__proto__` and
`constructor`, ReDoS patterns, RTL-override Unicode, null bytes, script/img
payloads, Mongo operators, wrong types) · invalid content types · malformed
JSON (400) · 5 MB payload (413) · duplicate params · invalid cursors · and a
seven-role authorization matrix (USER_A/USER_B/ORGANIZER_A/ORGANIZER_B/
ORG_MANAGER/COMMUNITY_OWNER/SUPER_ADMIN/ANON).

**§14 verified:** no account enumeration (identical response for unknown
address and wrong password) · brute force throttled at 429 with `Retry-After` ·
the attempted password, any OTP and any JWT are absent from server output.

Regression: 1090 → **1125 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 10 — RESULT: ✅ **DONE** (§30, `utils/app-error.js` + 47 new assertions)

**The systemic finding.** Four controllers contained **41 instances** of:

```js
} catch (error) {
  console.error(...);
  res.status(500).json({ success: false, message: error.message });
}
```

That is a §61 violation on every line: the raw error text goes straight to the
client. A malformed ObjectId produced a body reading
`Cast to ObjectId failed for value "not-an-object-id" (type string) at path
"_id" for model "Event"` — handing the client the model name, the field path
and the fact that Mongo is behind the API. It also reported a client mistake as
a 500, so it inflated error alerting and told the client to retry a request
that could never succeed.

All 41 now call `next(error)`, so the central taxonomy decides: a CastError is
400, a duplicate key 409, an outage 503, and nothing leaks.

**The closed code set.** Ten codes, and no others. Finer distinctions ride on
the HTTP status, not on invented codes — a 413 and a 400 are both
`VALIDATION_ERROR`, because "your input was wrong" is the whole of what the
client needs to know. Part 5's vocabulary (`VALIDATION_FAILED`, `UNAUTHORIZED`,
`OPERATION_TIMEOUT`, `INTERNAL`, `PAYLOAD_TOO_LARGE`, `DATABASE_UNAVAILABLE`,
`STORAGE_UPLOAD_FAILED`) is folded in, with a `LEGACY_ALIASES` map so a stale
code string still normalises rather than becoming a 500. The frontend only ever
branched on `RATE_LIMITED`, which is unchanged.

`IDEMPOTENCY_CONFLICT` was added — Part 5 had no name for it. It matters
because the recovery differs: a 409 `CONFLICT` means "re-read, someone else
changed it"; a 409 `IDEMPOTENCY_CONFLICT` means "you already sent this, do
nothing". Collapsing them makes clients retry work that already succeeded.

**Two scoping decisions, both deliberate:**
- The **Socket.IO protocol keeps its own code set** (`AUTH_FAILED`,
  `NOT_AUTHORIZED`, …). The live-event frontend branches on those; §30 governs
  the HTTP taxonomy, and renaming the socket protocol would have broken live
  quizzes for no benefit. The exclusion is by explicit filename and asserted,
  so it cannot quietly widen.
- `generateQuiz` forwarded two internal sentinels (`NOT_IMPLEMENTED`,
  `INVALID_INPUT`) verbatim — codes outside the closed set plus the generator's
  own message. Mapped to `PROVIDER_UNAVAILABLE` and `VALIDATION_ERROR`.

**One bug in my own earlier work:** the three Phase 6 fixes hardcoded the
legacy `VALIDATION_FAILED` name. Caught by the new scan, which is the point of
writing one.

`tests/platform.selftest.js` assertions were moved to the canonical names —
same status, same no-leak guarantee, same intent; nothing weakened.

Regression: 1125 → **1144 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 7 — RESULT: ✅ **DONE** (§12, §31 — 26 new assertions + `docs/PROVIDER-FAILURE-MATRIX.md` + `scripts/preflight-production.js`)

**§31 preflight.** `npm run preflight`. Its whole purpose is one distinction:
`CONFIGURED ≠ REACHABLE ≠ HEALTHY`. A check that reports success because an env
var is set is worse than no check, because it actively reassures — so each
dependency reports all four states independently and the exit code is driven by
HEALTH, never by CONFIGURED. Verified against all four outcomes: bare (exit 2),
healthy Mongo (exit 0), degraded weak-secret/http-origin (exit 1), unreachable
(exit 2), plus `--json`. It never mutates anything: a preflight that can change
state is a deployment step wearing a diagnostic's clothes.

**§12 — three real bugs, all from the same root cause: an HTTP 200 carrying a
malformed body was treated as a valid answer.**
1. **The rate limiter BLOCKED traffic.** The Lua tuple `[hits, reset, allowed]`
   was destructured out of a string, yielding `allowed=false`. That is the exact
   opposite of the documented fail-open policy: garbage from Upstash became a
   site-wide outage.
2. **Idempotency silently DROPPED legitimate writes.** `SET NX` answers `"OK"`
   or `nil`; the code read any non-`"OK"` value as "someone else has it", so a
   malformed response made a brand-new request look like a DUPLICATE. That is
   the one failure idempotency exists to prevent.
3. **Locks reported false contention** — a malformed result looked like another
   instance holding the lock.

All three now validate the shape and degrade instead of guessing.

**A fourth, subtler bug: the lock's fallback defeated the caller's choice.**
`RedisLockBackend` falls back to an IN-PROCESS lock on any error, so `acquire`
returned success and `withLock` reported `locked: true` — while two instances
could both hold "the" lock. Because acquire succeeded, `onUnavailable` was never
consulted, so an `abort` call site ran anyway believing itself protected. Now
the lock carries `distributed: false` when served by the fallback, and `abort`
releases and reports `ran:false`. A `proceed` caller still runs, but runs
*knowing* it is unprotected.

Also fixed: `withLock` decided "unavailable" from `stats_.errors > 0`, which is
**cumulative** — one transient blip made every later lock report unavailable, so
an `abort` site would never run again for the life of the process. Now
per-acquire.

`docs/PROVIDER-FAILURE-MATRIX.md` records all six modes and the per-subsystem
choice, including *why* each differs — a cache miss is slow, never wrong; a
blocked rate limiter is a self-inflicted outage; a duplicate registration is a
data bug. One rule for all four would get three of them wrong.

Regression: 1144 → **1170 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 13 — RESULT: ✅ **DONE** (§32 — 7 documents, 33 new assertions)

| Document | Covers |
|---|---|
| `PRODUCTION-HARDENING.md` | Index to the set; the five invariants; deploy checklist; what Part 7 found; **known limitations** |
| `SECURITY-MODEL.md` | Boundary · credentials · **§9 RLS decision** · §11 Redis · §13 cache privacy · **§15 real auth model** |
| `DATA-CONSISTENCY.md` | Outbox · dead letters · reconciliation · §6 normalisation · §7 migration safety · guarantees stated honestly |
| `PROVIDER-FAILURE-MATRIX.md` | Six Redis modes · per-subsystem degradation and **why each differs** · Supabase modes |
| `INCIDENT-RUNBOOK.md` | §24 severity ladder · alert→first-action · what never to do during an incident |
| `RESTORE-DRILL.md` | §18 real commands · §19 encryption & secret separation · result table |
| `LOAD-TESTING.md` | §20 profiles A–H · metrics · §25 budgets · §21 scale criteria · **§22 adapter trigger** |

**Documentation is asserted, not merely written.** 33 assertions check each
document exists, is substantial, and still records the specific decisions the
brief asked to be recorded — the RLS condition, "never auto-repaired", "no
source deletion from Mongo", "not deployed" for the Socket.IO adapter. If a
section is deleted, the build fails and the decision has to be made again
rather than silently forgotten. Documentation nobody maintains is worse than
none, because it is believed.

**Honesty about what is unproven.** `RESTORE-DRILL.md` states plainly that it
has not been executed end to end, and `PRODUCTION-HARDENING.md` carries a
limitations table: real-provider tests, the restore drill, load profiles and
the horizontal scale test are all **built but not yet run** against real
infrastructure. A hardening report that claims completeness is not
trustworthy.

Regression: 1170 → **1203 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 8 — RESULT: ✅ **DONE** (§23–§26 — `services/observability.service.js`, `scripts/perf-guard.js`, 37 new assertions)

**A flaky test turned out to be a real bug.** `tests/community.e2e.js` failed
intermittently under the full suite with `got=org_follow,comment,like,follow` —
4 notifications where 5 were expected. Not an ordering problem: the
`event_registration` notification was **missing**.

Cause: **`notify()` was never awaited** — 12 call sites fired it and forgot it.
The write raced the response, so a client that read `/notifications` immediately
after the triggering action could see nothing. `notify()` has its own try/catch
and never throws, so awaiting is free of risk: the only cost is one small write
on the request, and the benefit is that a 201 which implies a notification has
actually recorded it. The two mention loops now fan out with `Promise.all`
rather than serialising.

This is the kind of bug a green suite hides for years: it passed standalone
every time, and only lost the race under load.

**§24 — INFO added.** Part 6's ladder started at WARNING, so there was no way to
record "this happened, it is fine, do not act". Everything notable either became
a WARNING (and got ignored) or went unsaid.

**§25 — per-endpoint budgets with a CI guard.** `npm run perf-guard`. A global
p95 is the most misleading number in the system: the aggregate can be perfect
while one endpoint is unusable, and only the users on that endpoint know.
Crucially it fails on **MAJOR** regressions only (2× over budget, or 5× over the
error rate) — a guard that fails on a 1ms overshoot gets deleted within a week.
`--baseline` also catches slow drift (200→350→500ms is three passes and one
outage). Verified across healthy, warning, major and drift paths.

**§26 — query budget with documented exceptions.** N+1 and unbounded reads are
detected separately, because they fail differently: N+1 grows with the result
set (invisible at 10 rows, fatal at 10 000), while an unbounded read is fine
until the day the table is big enough. Exceptions are **declared with a reason
and a bound** — and claiming an undocumented exception is itself a HIGH
finding, because an informal exception hides the problem instead of explaining
it.

**§23 — six-domain rollup reporting DARK domains.** A domain nobody is
measuring is where incidents start, so the rollup says so rather than
presenting a clean-looking panel with holes in it.

Regression: 1203 → **1240 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 11 — RESULT: ✅ **DONE** (§27, §28, §29 — `services/url-safety.service.js`, `services/media.service.js` +dimension checks, `frontend/src/utils/safe-url.ts`, 44 new assertions)

**§27 — a real stored-XSS, fixed at the sink.** `org.website`,
`speaker.linkedin` and `event.onlineEventLink` are user-supplied and were
rendered straight into `href={...}`. A stored value of
`javascript:alert(document.cookie)` is a stored XSS: React warns about it in
development and then renders it anyway. The same value was also interpolated
into an HTML email with no escaping at all, so `"><script>` broke out of the
attribute entirely.

There was **no URL validation anywhere** — not frontend, not backend. Rejecting
at write time is now the primary control (only `http:`/`https:` survive, and
control characters are rejected outright because browsers strip them before
parsing the scheme, so `java\nscript:` would execute while looking harmless).
The frontend sanitiser is deliberately *not* redundant: data written before the
backend guard existed is still in the database, and a future code path could
bypass validation. **The sink has to be safe, not just the source.**

**§28 — magic bytes were not enough.** The existing check proved a file *was*
a PNG. It said nothing about how big it was. A 60 000 × 60 000 PNG is a few
kilobytes on the wire and gigabytes once decoded — the classic decompression
bomb, which the byte-size ceiling cannot catch because the wire size is tiny
*by design*. Dimensions are now read from the header and capped per side and
in total (12 000 px / 80 MP). Only the header is parsed; the image is never
decoded, because decoding is where the bomb goes off.

Writing the header parser produced two bugs worth recording. My first version
had **one shared 24-byte minimum length** for all four formats, which silently
disabled the check for GIF (needs 10 bytes) — the shortest format is exactly
the one an attacker would pick. And the parser's correctness was masked twice
by **malformed test buffers of my own making**, which I nearly read as parser
bugs. Verify the fixture before believing the failure.

**§28 also confirmed already-correct behaviour** rather than assuming it: the
local storage provider generates its own filename (`crypto.randomBytes`), never
writes `originalname`, sanitises the folder segment, and derives the extension
from the validated MIME — so no user filename ever reaches the filesystem.

**§29 — recorded, not "fixed".** All 18 buckets live in one central table
(good: any change is one reviewable diff). But every bucket shares a single
**IP-keyed** generator. That is correct for AUTH, where the user is by
definition unknown before login and IP is the only identity available against
credential stuffing. It is wrong for authenticated write domains: 500 people
behind one university NAT share a bucket, so one hot user throttles everyone —
precisely the hazard §29 names. §29 also says *measure before changing
anything*, and there is no traffic data to measure. So this is recorded as a
known limitation with its trigger, not silently changed.

**One existing test fixture was corrected.** Phase 4's PNG fixture was a
truncated header that `sniffMime` accepted but which decoded to 0×0 pixels.
The new dimension check correctly rejected it. No assertion was changed or
weakened — the input was made a structurally valid PNG instead.

Regression: 1240 → **1284 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 9 — RESULT: ✅ **DONE** (§20, §21, §22 — `scripts/load-test.js`, `tests/part7-scale.selftest.js`, `tests/helpers/boot-instance.js`, 44 new assertions)

**§20 — a load harness that runs, replacing a doc that only described one.**
`docs/LOAD-TESTING.md` specified profiles A–H, but nothing could execute them
and k6 is not installed. A load test nobody can run is a load test that never
runs, so `scripts/load-test.js` is dependency-free (Node `http` only) and
`npm run load-test` works anywhere Node does. Verified by execution: profile A
against a live server reported `722 requests, p50 10.4 / p95 88.6 / p99 113.9
ms, 0% errors`.

Three decisions inside it are worth naming. **A 429 is not counted as an
error** — otherwise the harness reports failure precisely when the rate
limiter is doing its job, which trains whoever reads it to ignore error rates.
**The reservoir is bounded**, because profile F runs for two hours and storing
every sample would exhaust memory halfway through a soak; an honest
approximation beats a number that dies at the 90-minute mark. And **profiles F
and G refuse to run without `--allow-destructive`** — verified by spawning the
process and asserting a non-zero exit, because a two-hour soak or a Redis
flush should never happen by accident.

**Profile C delegates instead of duplicating.** I had written a hand-rolled
Engine.IO/Socket.IO client for it. Then I found `tests/live.load.js` — Part 4
already built a proven 500-client harness with rate-limit cap handling. Mine
was an untested reimplementation of the hardest part of the system. I deleted
it and made profile C spawn the existing harness, verified at 25 clients:
**25/25 sockets, 100% joins, 100% broadcast fan-out, zero errors**. Maintaining
two socket clients, one untested, is how realtime breaks.

**§21 — two real processes, because one process cannot prove this.** `server.js`
binds and self-starts without exporting the app, so the obvious shortcut is
clearing `require.cache` and booting twice in-process. That would prove
nothing: both copies would share the same module instances and therefore the
same in-memory state — which is exactly what must be shown to be absent. So
the test forks two processes on ports 5101/5102 against one shared Mongo and
requires login to succeed on the instance that did *not* create the user:
**A writes → B authenticates, B writes → A authenticates, and a token issued
by either is accepted by the other.** That last check is the strongest, since
it fails immediately if either instance keeps session state locally.

**§22 — confirmed correct, not assumed:** the adapter package is not in
dependencies, `realtime.service.js` wires no adapter, and the trigger
(`replicas > 1` AND live rooms spanning replicas) is recorded in the docs.

**One incidental measurement.** Profile A at 60 rps from a single IP drew
**422 rate-limited responses out of 722**. That is the limiter working, and it
is direct evidence for the NAT limitation recorded in §29: one source IP
saturates a shared bucket well before the server is under any real strain.

Regression: 1284 → **1328 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 12 — RESULT: ✅ **DONE** (§18, §19 — `scripts/verify-restore.js`, `scripts/scan-secrets.js`, `tests/part7-recovery.selftest.js`, 36 new assertions)

**§18 — the drill could be followed but not judged.** `RESTORE-DRILL.md` said
how to dump and restore. It never answered the question that matters: *is the
data that came back correct?* `mongorestore` exits 0 when it has finished
writing; it does not know whether half a collection is missing or whether
references still resolve. A restore that "worked" and a restore that worked
are different things, and the difference surfaces later, when a user opens a
registration pointing at an event that isn't there.

`npm run verify-restore` now answers it, and is deliberately **read-only** —
asserted by test, because a verifier that can repair is a verifier that can
destroy when someone runs it in a hurry against the wrong host. It checks the
13 required collections, sampled referential integrity, required fields,
surviving indexes, and backup age. Proven by breaking things: a faithful
restore passes, a 3-of-10 restore is caught at 30%, an orphaned comment is
caught, dropped indexes are caught, and **running without `--source` fails
rather than implying completeness** — because a restore that lost 40% of
registrations is internally consistent and still a disaster.

**§19 — the quiet leak.** Code gets reviewed; a `tar.gz` of a deployment
directory does not, and it contains `.env` if `.env` was there. `npm run
scan-secrets` catches env files, PEM keys, service-role tokens, connection
strings with inline passwords, AWS and Stripe keys — and **never prints the
secret**, only its kind, location and length. A scanner that echoes the
credential into CI logs has leaked the very thing it protects; a canary in the
test asserts the value never appears in output.

**Getting the scanner honest took four false-positive/false-negative cycles**,
and each one was the same lesson in a different costume:

1. It flagged test fixtures (`password = "test-secret"`). A scanner that cries
   wolf gets disabled — but the naive fix (entropy) backfired.
2. Real credentials stopped being caught, because `admin` is a legitimate
   username and **random base64 contains `bar` and `test` by chance**. Token
   matching must not apply to long high-entropy values.
3. `isFixtureUri` returned "fixture" when it found no host — silently clearing
   every non-URI secret, since an API key has no `@` either.
4. The deepest one: **`rule.valueOf` was inherited from `Object.prototype`**,
   so `rule.valueOf ? ...` was *always* truthy and `Object.prototype.valueOf(v)`
   returned the boxed object, turning every candidate into `[object Object]`
   (15 chars) and quietly defeating the entropy check. Renamed to `extract`.

All four were found by running the tool against planted secrets rather than
reading it. The repo now scans clean while all six planted credential types
are still detected.

**One environment trap worth recording:** each in-memory mongod reserves
~200 MB of tmpfs, and the six e2e suites ahead of this one leave stale
directories behind, so the suite died with `OutOfDiskSpace` — which reads as a
product failure and is not one. It now reclaims stale state **only after
mongod has actually refused to start** (never speculatively), and retries once.

Regression: 1328 → **1364 assertions, 0 failed** (924 floor held); 6/6 e2e.

### Phase 1 — RESULT: ✅ **DONE** (46 assertions in tests/phase11.selftest.js)

- `services/reconciliation.service.js` — checkpointed, bounded, idempotent.
- `scripts/reconcile-supabase.js` — `--dry-run` (default), `--apply`,
  `--entity=`, `--limit=`, `--json`, `--reset-checkpoint`.

**Detects all seven §2 conditions:** missing target · drifted fields · orphan
(target exists, source gone) · stale target · failed/retrying entries ·
dead-letter entries. Plus a seventh we added: **ambiguous drift**, reported but
never auto-repaired.

**§6 normalisation.** Naive comparison produces false drift that drowns out
real drift. Normalised before compare: Date ⇄ ISO string, ObjectId ⇄ string,
null ⇄ undefined, and array ordering where order is not meaningful (topics,
interests). Sub-second timestamp precision is tolerated — Mongo and Postgres do
not store identical precision. Trigger-owned counters (`likes_count`,
`followers_count`) are excluded entirely: Postgres maintains them, so comparing
would flag every row.

**§4 idempotence proven by test:** run 1 reports `drifted=1 missing=1
repaired=2`; after draining, run 2 reports `drifted=0 missing=0 repaired=0`
with all 3 rows matched and no duplicates created.

**§3 checkpoints.** `{lastCheckedAt, lastCheckedId}` per entity type, keyset
resume, bounded batches, streamed with a cursor. A run that reaches the end
marks itself `wrapped` so the next pass starts over — without wrapping, rows
created before the checkpoint would never be re-checked.

**Repair enqueues, never writes directly** — same code path as live sync, so
what reconciliation fixes is exactly what the live path would have produced.

**§7 verified by assertion, not intention:** no migration script contains a
source-deletion flag, and none calls `deleteMany`/`deleteOne`/`drop`.

Regression: 924 → **970 assertions, 0 failed**; 6/6 e2e.
| 2 | Dead-letter system + migration safety | §5, §7 | ✅ |

### Phase 2 — RESULT: ✅ **DONE** (73 assertions in tests/phase11.selftest.js)

- `models/outbox.model.js` — ADDED `lastErrorCode` · `lastErrorAt` ·
  `deadLetteredAt`, plus index `{status:1, deadLetteredAt:1}` for the dashboard
  age sort.
- `services/outbox.service.js` — `fail()` populates all four §5 fields and maps
  the failure to a **stable code of ours** (`err.code`, `TIMEOUT` on abort, else
  `UPSTREAM`) — never a raw Postgres SQLSTATE, which leaks schema detail and is
  not stable enough to alert on. Added `deadLetters()` + `processingRate()`.
- `services/infrastructure.service.js` — new `collectOutbox()` panel: backlog ·
  ratePerMinute · retrying · deadLettered · oldestPendingMs ·
  oldestDeadLetterMs · bounded `recentDead` sample (entity reference + code
  only).
- Severity: `dead > 0` and age < 15 min → **HIGH**; age ≥ 15 min →
  **CRITICAL**; `pending > 10 000` → WARNING. Rate sits next to backlog because
  a large draining backlog is fine and a small stuck one is an incident.

**§5 fields stored (asserted):** id · entityType · entityId · operation ·
attempts · lastErrorCode · lastErrorAt · createdAt · deadLetteredAt.
**Asserted absent:** any credential-shaped value, any request body.

**REGRESSION CAUGHT AND FIXED — worth remembering.** The first model edit
dropped `lastAttemptAt` and `processedAt` while adding the §5 fields.
`requeueStalled` filters on `lastAttemptAt`, so stalled entries would have
stayed `processing` forever and never reached Supabase. The pre-existing Phase
10 assertion *"a stalled entry is recovered rather than lost"* caught it. Both
fields restored. **Lesson: when adding fields to a schema, diff the field list
against every query in the service that uses it — the tests only catch it after
the fact.**

**ENVIRONMENT.** `/tmp` is a 993M tmpfs. Leaked `mongo-mem-*` data dirs filled
it to 93% and mongod began fasserting on no space. Symptom:
`StdoutInstanceError: Mongod internal error (fassert() failure)` — it reads
like a code failure but is disk pressure. Fix: `rm -rf /tmp/mongo-mem-*`
between full runs.

Regression: 970 → **997 assertions, 0 failed** (924 floor held); 6/6 e2e.

---

## What CANNOT be completed in this environment (needs the operator)

These are built as runnable tooling + exact commands, but the run itself
requires real infrastructure or credentials the sandbox does not have.

| § | Item | Blocker |
|---|---|---|
| §1 | Real-provider tests | Needs real `UPSTASH_*` / `SUPABASE_*` credentials |
| §18 | Backup restore drill | Needs a real Mongo deployment + isolated Supabase project |
| §20 | Load tests (profile C: 500 participants) | Needs real backend + DB |
| §21 | Horizontal scale test (Instance A + B) | Needs two real backend processes |
| §31 | Preflight | Buildable; only meaningful against the real environment |

Everything else is buildable and testable here.
