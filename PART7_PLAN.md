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
| 4 | Security audits (Supabase, Redis, cache) | §8, §9, §11, §13 | pending |
| 5 | Community ownership & Super Admin protection | §10 | pending |
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
