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
| 2 | Dead-letter system + migration safety | §5, §7 | pending |
| 3 | Real-provider test suite | §1 | pending |
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
