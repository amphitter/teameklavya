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
| 6 | Auth hardening, fuzzing, authorization matrix | §14, §15, §16, §17 | pending |
| 7 | Provider failure matrix + preflight | §12, §31 | pending |
| 8 | Observability, alerting, perf & query budgets | §23, §24, §25, §26 | pending |
| 9 | Load, horizontal scale, realtime readiness | §20, §21, §22 | pending |
| 10 | Error taxonomy | §30 | pending |
| 11 | Frontend + upload + rate-limit review | §27, §28, §29 | pending |
| 12 | Restore drill, backups, secret separation | §18, §19 | pending |
| 13 | Documentation set | §32 | pending |
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
