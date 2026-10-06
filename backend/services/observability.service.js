/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §23 OBSERVABILITY · §24 ALERTING · §25 PERF BUDGETS · §26 QUERY BUDGET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Four related problems, one module, because they are the same activity:
 * deciding IN ADVANCE what "too slow" and "too many" mean, so that the
 * decision is made calmly in code rather than at 3am during an incident.
 *
 *   §23  can we see all six domains?
 *   §24  does anything notice, and at the right severity?
 *   §25  is the API slower than it was, per endpoint?
 *   §26  is any request issuing more queries than it should?
 *
 * A budget that is not enforced is a comment. Every number below is checked by
 * something, and the exceptions are written down rather than left as folklore.
 */

"use strict";

/* ═══ §24 — Severity ladder ════════════════════════════════════════════════
 *
 * INFO exists because Part 6's ladder started at WARNING, which meant an
 * operator had no way to record "this happened, it is fine, do not act" — so
 * everything notable either became a WARNING (and was ignored) or was left
 * unsaid. INFO is for the events you want on the record but do not want to be
 * woken for.
 */
const SEVERITY = Object.freeze({
  INFO: "INFO",
  WARNING: "WARNING",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

const SEVERITY_RANK = Object.freeze({
  INFO: 0,
  WARNING: 1,
  HIGH: 2,
  CRITICAL: 3,
});

function worstSeverity(...levels) {
  let worst = null;
  for (const l of levels) {
    if (!l) continue;
    if (worst === null || SEVERITY_RANK[l] > SEVERITY_RANK[worst]) worst = l;
  }
  return worst;
}

/* ═══ §25 — Per-endpoint performance budgets ═══════════════════════════════
 *
 * Budgets are per CLASS with per-endpoint overrides, because a global p95 is
 * the single most misleading number in a system like this: an aggregate can
 * look perfectly healthy while one endpoint is unusable, and the users on that
 * endpoint are the only ones who know.
 *
 * The override list is deliberately short. An override for every endpoint is a
 * sign the defaults are wrong, not that the endpoints are special.
 */
const DEFAULT_BUDGET = Object.freeze({ p95: 600, p99: 1500, errorRate: 0.01 });

const PERF_BUDGETS = Object.freeze({
  // Reads that are expected to hit cache should be very fast.
  "GET /api/events": { p95: 150, p99: 400, errorRate: 0.005 },
  "GET /api/events/trending": { p95: 150, p99: 400, errorRate: 0.005 },
  "GET /api/posts/feed": { p95: 200, p99: 500, errorRate: 0.005 },
  "GET /api/search": { p95: 400, p99: 900, errorRate: 0.01 },

  // Uncached reads get more room.
  "GET /api/communities/:slug": { p95: 400, p99: 900 },
  "GET /api/organizations/:slug": { p95: 400, p99: 900 },

  // Writes.
  "POST /api/events": { p95: 800, p99: 2000, errorRate: 0.01 },
  "POST /api/posts": { p95: 600, p99: 1500, errorRate: 0.01 },
  "POST /api/communities": { p95: 800, p99: 2000, errorRate: 0.01 },

  // Business-critical: slower is acceptable, failure is not.
  "POST /api/registration": { p95: 1200, p99: 3000, errorRate: 0.001 },
});

/** Match a concrete request path against a budget key containing :params. */
function budgetKeyFor(method, path) {
  const key = `${method} ${path}`;
  if (PERF_BUDGETS[key]) return key;

  let best = null;
  for (const k of Object.keys(PERF_BUDGETS)) {
    const [m, p] = k.split(" ");
    if (m !== method) continue;
    const pattern = p
      .split("/")
      .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
    if (new RegExp(`^${pattern}$`).test(path)) {
      // Prefer the most specific (longest, fewest placeholders) match.
      const specificity = p.split("/").filter((s) => !s.startsWith(":")).length;
      if (!best || specificity > best.specificity) best = { key: k, specificity };
    }
  }
  return best ? best.key : null;
}

function budgetFor(method, path) {
  const key = budgetKeyFor(method, path);
  return { key, budget: { ...DEFAULT_BUDGET, ...(key ? PERF_BUDGETS[key] : {}) } };
}

/**
 * Evaluate one endpoint's measurements against its budget.
 *
 * `tolerance` exists because a budget that fails on a 1ms overshoot gets
 * disabled by the first team it annoys. A "major regression" is a real
 * multiple over budget, not noise — that is what blocks CI.
 */
function evaluateEndpoint({ method, path, p95, p99, errorRate }, { tolerance = 1.1 } = {}) {
  const { key, budget } = budgetFor(method, path);
  const breaches = [];
  let severity = null;

  if (typeof p95 === "number" && p95 > budget.p95) {
    const major = p95 > budget.p95 * tolerance * 2;
    breaches.push({ metric: "p95", actual: p95, budget: budget.p95, major });
    severity = worstSeverity(severity, major ? SEVERITY.CRITICAL : SEVERITY.WARNING);
  }
  if (typeof p99 === "number" && p99 > budget.p99) {
    const major = p99 > budget.p99 * tolerance * 2;
    breaches.push({ metric: "p99", actual: p99, budget: budget.p99, major });
    severity = worstSeverity(severity, major ? SEVERITY.HIGH : SEVERITY.WARNING);
  }
  if (typeof errorRate === "number" && errorRate > budget.errorRate) {
    // Errors always outrank latency: a fast endpoint that fails is worse than
    // a slow one that works.
    const major = errorRate > budget.errorRate * 5;
    breaches.push({ metric: "errorRate", actual: errorRate, budget: budget.errorRate, major });
    severity = worstSeverity(severity, major ? SEVERITY.CRITICAL : SEVERITY.HIGH);
  }

  return { endpoint: `${method} ${path}`, budgetKey: key, budget, breaches, severity };
}

/* ═══ §26 — Database query budget ══════════════════════════════════════════
 *
 * Two distinct failures, often confused:
 *
 *   N+1        one query per row of a previous query. Latency grows linearly
 *              with the result set, so it is invisible with 10 rows and fatal
 *              with 10 000.
 *   UNBOUNDED  a query with no `limit`. Fine today, an outage the day the
 *              table is big enough.
 *
 * Both are detected by counting queries per request and checking that reads
 * carry a bound.
 *
 * EXCEPTIONS ARE DOCUMENTED, not implicit. Every exception states what it is,
 * why it is legitimate, and what bounds it anyway — an undocumented exception
 * is just a bug that has been tolerated.
 */
const QUERY_BUDGET = Object.freeze({
  /** Queries in one request before we call it an N+1. */
  maxQueriesPerRequest: 20,
  /** Rows a single read may return without paging. */
  maxRowsPerQuery: 1000,
});

const QUERY_EXCEPTIONS = Object.freeze([
  {
    name: "admin CSV export",
    why: "Streams a full table deliberately; it is operator-initiated, rare, and runs under a lock so it cannot overlap itself.",
    bound: "Streamed with a cursor and hard-capped by the export row limit.",
  },
  {
    name: "reconciliation",
    why: "Must compare every row of an entity type. Paging would leave gaps.",
    bound: "Bounded batch size and a checkpoint cursor; never loads a collection whole.",
  },
  {
    name: "backfill",
    why: "One-time historical migration.",
    bound: "Explicit `--limit`, dry-run by default, and never run against live traffic windows.",
  },
  {
    name: "analytics aggregation",
    why: "Aggregates server-side in one query rather than fetching rows to count them.",
    bound: "Single aggregation query; result cardinality is the aggregate, not the table.",
  },
]);

/**
 * @param {object} ctx
 * @param {number} ctx.queries      query count for this request
 * @param {number} [ctx.maxRows]    largest single read in this request
 * @param {boolean} [ctx.bounded]   did every read carry a limit?
 * @param {string} [ctx.exception]  name of a documented exception
 */
function evaluateQueries({ queries, maxRows = 0, bounded = true, exception = null } = {}) {
  const findings = [];
  let severity = null;

  const declared = exception ? QUERY_EXCEPTIONS.find((e) => e.name === exception) : null;
  if (exception && !declared) {
    // Claiming an exception that is not on the list is worse than not claiming
    // one: it hides the finding instead of explaining it.
    findings.push({ type: "UNDECLARED_EXCEPTION", detail: `undocumented exception "${exception}"` });
    severity = worstSeverity(severity, SEVERITY.HIGH);
  }

  if (typeof queries === "number" && queries > QUERY_BUDGET.maxQueriesPerRequest && !declared) {
    findings.push({
      type: "N_PLUS_ONE",
      detail: `${queries} queries in one request (budget ${QUERY_BUDGET.maxQueriesPerRequest})`,
    });
    severity = worstSeverity(severity, queries > QUERY_BUDGET.maxQueriesPerRequest * 3 ? SEVERITY.HIGH : SEVERITY.WARNING);
  }

  if (typeof maxRows === "number" && maxRows > QUERY_BUDGET.maxRowsPerQuery && !declared) {
    findings.push({
      type: "UNBOUNDED_READ",
      detail: `read returned ${maxRows} rows (budget ${QUERY_BUDGET.maxRowsPerQuery})`,
    });
    severity = worstSeverity(severity, SEVERITY.WARNING);
  }

  if (bounded === false && !declared) {
    findings.push({ type: "UNBOUNDED_QUERY", detail: "a read was issued without a limit" });
    severity = worstSeverity(severity, SEVERITY.HIGH);
  }

  return { exception: declared || null, findings, severity, withinBudget: findings.length === 0 };
}

/* ═══ §23 — The six-domain rollup ══════════════════════════════════════════
 *
 * §23 asks for API, Mongo, Supabase, Redis, realtime and storage. Most of
 * those are already counted somewhere; the gap is that no single view proves
 * all six are being observed. `snapshot()` is that view, and it reports which
 * domains are DARK — a domain nobody is measuring is the most likely place for
 * an incident to start.
 */
function snapshot() {
  const metrics = require("./metrics.service");
  const m = metrics.snapshot();

  const api = {
    p50: m.api?.p50 ?? null,
    p95: m.api?.p95 ?? null,
    p99: m.api?.p99 ?? null,
    samples: m.api?.samples ?? 0,
    statuses: m.statuses || {},
    // Latency samples are recorded unconditionally, so the API domain is
    // always observed (though it is dark until traffic arrives).
    observed: true,
  };

  const mongo = {
    // Surfaced through the provider counters and the admin dashboard.
    provider: m.providers?.mongo || null,
    observed: Boolean(m.providers?.mongo),
  };

  const supabase = {
    provider: m.providers?.supabase || null,
    observed: Boolean(m.providers?.supabase),
  };

  const redis = {
    provider: m.providers?.redis || null,
    cache: m.cache || {},
    observed: Boolean(m.providers?.redis) || (m.cache?.hits ?? 0) + (m.cache?.misses ?? 0) > 0,
  };

  const realtime = {
    connected: m.sockets?.connected ?? 0,
    peak: m.sockets?.peak ?? 0,
    errors: m.sockets?.errors ?? 0,
    observed: true, // connection counts are maintained unconditionally
  };

  const storage = {
    uploads: m.uploads || {},
    observed: (m.uploads?.successes ?? 0) + (m.uploads?.failures ?? 0) > 0 || "uploads" in m,
  };

  const domains = { api, mongo, supabase, redis, realtime, storage };
  const dark = Object.entries(domains)
    .filter(([, v]) => v.observed === false)
    .map(([k]) => k);

  return {
    domains,
    dark,
    severity: dark.length ? SEVERITY.WARNING : null,
    rateLimits: m.rateLimits || {},
  };
}

module.exports = {
  SEVERITY,
  SEVERITY_RANK,
  worstSeverity,

  DEFAULT_BUDGET,
  PERF_BUDGETS,
  budgetKeyFor,
  budgetFor,
  evaluateEndpoint,

  QUERY_BUDGET,
  QUERY_EXCEPTIONS,
  evaluateQueries,

  snapshot,
};
