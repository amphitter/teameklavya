#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §25  PERFORMANCE REGRESSION GUARD
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  node scripts/perf-guard.js --input=results.json [--baseline=baseline.json]
 *                             [--tolerance=1.1] [--json] [--update-baseline]
 *
 * Reads k6 output, evaluates every endpoint against its budget
 * (config: services/observability.service.js), and fails on a MAJOR regression.
 *
 * WHY "MAJOR" AND NOT "ANY"
 * ────────────────────────
 * A guard that fails the build on a 1ms overshoot gets disabled within a week —
 * usually by being deleted, occasionally by someone "temporarily" commenting it
 * out. Both outcomes are worse than a slightly loose threshold. So:
 *
 *   within budget            → pass
 *   over budget, under 2×    → WARNING, printed, exit 0
 *   2× over budget, or error rate 5× over → MAJOR, exit 1
 *
 * The guard is meant to catch the change that halves throughput, not to police
 * noise.
 *
 * BASELINES
 * ─────────
 * With --baseline, an endpoint is also compared against the last known-good
 * run. This catches a slow drift that never crosses the absolute budget: 200ms
 * → 350ms → 500ms is three passes and one outage waiting to happen.
 *
 * --update-baseline writes the current run as the new baseline. Only do this
 * when the numbers are good AND understood — a baseline updated to hide a
 * regression is a regression with extra steps.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { evaluateEndpoint, SEVERITY } = require("../services/observability.service");

/* ── Args ─────────────────────────────────────────────────────────────────── */

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const inputPath = arg("input");
const baselinePath = arg("baseline");
const tolerance = Number(arg("tolerance", "1.1")) || 1.1;
const asJson = process.argv.includes("--json");
const updateBaseline = process.argv.includes("--update-baseline");

if (!inputPath) {
  console.error("usage: node scripts/perf-guard.js --input=results.json [--baseline=…]");
  process.exit(2);
}

/* ── Input parsing ────────────────────────────────────────────────────────── */

/**
 * Accepts either:
 *   k6 --out json=… newline-delimited JSON (metric points)
 *   k6 --summary-export=… JSON summary ({ metrics: { http_req_duration: { p(95)… } } })
 *   a pre-aggregated file ({ endpoints: [{ method, path, p95, p99, errorRate }] })
 */
function loadSamples(file) {
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];

  // Pre-aggregated form — the simplest and what most CI will produce.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.endpoints)) return parsed.endpoints;
  } catch {
    /* fall through to NDJSON below */
  }

  const samples = [];
  const byKey = new Map();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    // k6 NDJSON: { metric, data: { time, value, tags } }
    if (rec.metric !== "http_req_duration" || !rec.data) continue;
    const tags = rec.data.tags || {};
    const method = String(tags.method || "GET").toUpperCase();
    const url = String(tags.url || tags.name || "");
    let pathname = url;
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* leave as-is */
    }
    const key = `${method} ${pathname}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(Number(rec.data.value) || 0);
  }

  for (const [key, values] of byKey) {
    const sorted = values.slice().sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    const [method, p] = key.split(" ");
    samples.push({ method, path: p, p95: pct(95), p99: pct(99) });
  }
  return samples;
}

/* ── Evaluate ─────────────────────────────────────────────────────────────── */

const samples = loadSamples(inputPath);
if (!samples.length) {
  console.error(`perf-guard: no samples found in ${inputPath}`);
  process.exit(2);
}

let baseline = null;
if (baselinePath && fs.existsSync(baselinePath)) {
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch {
    console.warn(`perf-guard: could not read baseline ${baselinePath} — continuing without it`);
  }
}
const baselineMap = new Map((baseline?.endpoints || []).map((e) => [`${e.method} ${e.path}`, e]));

const results = samples.map((s) => {
  const evaluated = evaluateEndpoint(s, { tolerance });

  // Drift against the last known-good run, which the absolute budget cannot see.
  const prev = baselineMap.get(`${s.method} ${s.path}`);
  let drift = null;
  if (prev && typeof prev.p95 === "number" && typeof s.p95 === "number" && prev.p95 > 0) {
    const ratio = s.p95 / prev.p95;
    if (ratio > 1.5) {
      drift = { from: prev.p95, to: s.p95, ratio: Math.round(ratio * 100) / 100 };
      evaluated.severity = SEVERITY.CRITICAL;
      evaluated.breaches.push({
        metric: "p95-drift",
        actual: s.p95,
        budget: prev.p95,
        major: true,
        detail: `p95 grew ${ratio.toFixed(2)}× against the baseline`,
      });
    }
  }
  return { ...evaluated, drift };
});

const major = results.filter((r) => r.breaches.some((b) => b.major));
const warnings = results.filter((r) => r.breaches.length && !r.breaches.some((b) => b.major));

/* ── Report ───────────────────────────────────────────────────────────────── */

const payload = {
  tolerance,
  evaluated: results.length,
  passing: results.filter((r) => !r.breaches.length).length,
  warnings: warnings.length,
  major: major.length,
  results,
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  §25 PERFORMANCE REGRESSION GUARD");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  input      : ${inputPath}`);
  console.log(`  baseline   : ${baselinePath || "(none — absolute budgets only)"}`);
  console.log(`  tolerance  : ${tolerance}× (major = 2× over budget, or 5× over error rate)\n`);

  for (const r of results) {
    const icon = r.breaches.some((b) => b.major) ? "❌" : r.breaches.length ? "⚠️ " : "✅";
    const budgetDesc = `p95≤${r.budget.p95} p99≤${r.budget.p99} err≤${r.budget.errorRate}`;
    console.log(`  ${icon} ${r.endpoint}`);
    console.log(`      budget: ${budgetDesc}`);
    for (const b of r.breaches) {
      console.log(`      └ ${b.metric}: ${b.actual} vs budget ${b.budget}${b.major ? "  [MAJOR]" : ""}${b.detail ? ` — ${b.detail}` : ""}`);
    }
    if (r.drift) {
      console.log(`      └ drift: p95 ${r.drift.from} → ${r.drift.to} (${r.drift.ratio}× baseline)`);
    }
  }

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log(`  passing: ${payload.passing}/${payload.evaluated}   warnings: ${payload.warnings}   MAJOR: ${payload.major}`);
  if (major.length) {
    console.log("\n  BLOCKING — a major regression fails the build:");
    for (const r of major) console.log(`    · ${r.endpoint}`);
  }
  console.log(major.length ? "\n  RESULT: FAIL\n" : "\n  RESULT: PASS\n");
}

if (updateBaseline && baselinePath && !major.length) {
  fs.writeFileSync(
    baselinePath,
    JSON.stringify(
      { updatedAt: new Date().toISOString(), endpoints: samples },
      null,
      2
    )
  );
  console.log(`baseline updated: ${baselinePath}`);
}

process.exit(major.length ? 1 : 0);
