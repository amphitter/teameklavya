#!/usr/bin/env node
/**
 * EventHub — Part 5, Phase 5 selftest (frontend data layer + request efficiency)
 * ─────────────────────────────────────────────────────────────────────────────
 * Exercises frontend/src/lib/query.ts directly by transpiling it with the
 * frontend's own TypeScript compiler and stubbing its two runtime imports
 * ("react" and the "@/utils/api" axios instance). No browser, no React
 * renderer — the hooks' *logic* is covered through the pure exports they are
 * built on, and the wiring is covered by a static audit of the app tree.
 *
 * Run: npm run test:phase5
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const REPO = path.join(__dirname, "..", "..");
const FRONTEND = path.join(REPO, "frontend");
const SRC = path.join(FRONTEND, "src");

/* ── tiny harness ─────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];
let section = "";

function sec(name) {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(`[${section}] ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ── module stubs ─────────────────────────────────────────────────────── */

/** Every network call the query layer makes funnels through here. */
const net = {
  calls: [],
  handler: null, // (config) => data | throws
  reset(h) {
    this.calls = [];
    this.handler = h;
  },
};

const apiStub = {
  async request(config) {
    net.calls.push(config);
    if (!net.handler) throw new Error("no handler installed");
    const data = await net.handler(config, net.calls.length);
    return { data, status: 200, config, headers: {}, statusText: "OK" };
  },
  async post(url, body, config) {
    net.calls.push({ url, method: "post", data: body, ...config });
    if (!net.handler) throw new Error("no handler installed");
    const data = await net.handler({ url, method: "post", data: body, ...config }, net.calls.length);
    return { data, status: 200, config, headers: {}, statusText: "OK" };
  },
};

/** Minimal React: enough for the module to load and hooks to be callable. */
const reactStub = {
  useState(init) {
    const value = typeof init === "function" ? init() : init;
    return [value, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useRef(init) {
    return { current: init };
  },
  useMemo(fn) {
    return fn();
  },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "react") return reactStub;
  if (request === "@/utils/api") return { api: apiStub, default: { api: apiStub } };
  if (request === "axios") return { default: {}, isCancel: (e) => !!e && e.name === "CanceledError" };
  return realLoad.call(this, request, parent, isMain);
};

/* ── transpile the TypeScript module ──────────────────────────────────── */

const ts = require(path.join(FRONTEND, "node_modules", "typescript"));

function loadQueryModule() {
  const file = path.join(SRC, "lib", "query.ts");
  const source = fs.readFileSync(file, "utf8");
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      paths: { "@/*": ["./src/*"] },
    },
    fileName: file,
  });
  const tmp = path.join(os.tmpdir(), `eh-query-${process.pid}.cjs`);
  fs.writeFileSync(tmp, out.outputText);
  const mod = require(tmp);
  fs.unlinkSync(tmp);
  return mod;
}

const Q = loadQueryModule();

/* ═══════════════════════════════════════════════════════════════════════
 * 1. Module surface
 * ══════════════════════════════════════════════════════════════════════ */

sec("1. Data layer surface");

ok("module loads and exports a query cache", typeof Q.queryCache === "object");
ok("exports queryClient with the React-Query-shaped API",
  ["getQueryData", "setQueryData", "invalidateQueries", "prefetchQuery", "removeQueries", "clear"]
    .every((m) => typeof Q.queryClient[m] === "function"));
ok("exports all five hooks",
  ["useQuery", "useInfiniteQuery", "useMutation", "usePolling", "usePrefetchOnHover"]
    .every((h) => typeof Q[h] === "function"));
ok("exports the retry primitives",
  ["isRetryable", "isCancelled", "backoffMs", "fetchWithRetry", "dedupedFetch", "idempotentPost"]
    .every((h) => typeof Q[h] === "function"));

/* ═══════════════════════════════════════════════════════════════════════
 * 2. Cache keys (§11 — client keys mirror the server's key builder)
 * ══════════════════════════════════════════════════════════════════════ */

sec("2. Cache keys");

eq("keyToString is stable and ordered", Q.keyToString(["event", "123"]), '["event","123"]');
ok("different keys do not collide",
  Q.keyToString(["event", "123"]) !== Q.keyToString(["event", "124"]));
ok("array order matters",
  Q.keyToString(["a", "b"]) !== Q.keyToString(["b", "a"]));

Q.queryClient.setQueryData(["event", "abc"], { title: "Hacknight" });
eq("setQueryData/getQueryData round-trip",
  Q.queryClient.getQueryData(["event", "abc"]).title, "Hacknight");
eq("a different key misses", Q.queryClient.getQueryData(["event", "zzz"]), undefined);

// invalidateQueries(["event"]) must clear ["event","abc"] but not ["post","1"]
Q.queryClient.setQueryData(["post", "1"], { id: 1 });
Q.queryClient.invalidateQueries(["event"]);
eq("invalidateQueries(['event']) clears event members",
  Q.queryClient.getQueryData(["event", "abc"]), undefined);
ok("invalidateQueries(['event']) leaves other domains alone",
  Q.queryClient.getQueryData(["post", "1"]) !== undefined);

/* ═══════════════════════════════════════════════════════════════════════
 * 3. Deduplication (§15 — 5 components, 1 backend operation)
 * ══════════════════════════════════════════════════════════════════════ */

sec("3. Deduplication (§15)");

(async () => {
  Q.queryClient.clear();

  let resolves = 0;
  net.reset(async () => {
    resolves++;
    await new Promise((r) => setTimeout(r, 20));
    return { id: "e1", title: "Shared" };
  });

  // Five components asking for the same thing in the same tick.
  const five = await Promise.all([
    Q.dedupedFetch('["event","e1"]', "/events/e1"),
    Q.dedupedFetch('["event","e1"]', "/events/e1"),
    Q.dedupedFetch('["event","e1"]', "/events/e1"),
    Q.dedupedFetch('["event","e1"]', "/events/e1"),
    Q.dedupedFetch('["event","e1"]', "/events/e1"),
  ]);
  eq("5 concurrent callers → 1 network request", net.calls.length, 1);
  ok("all 5 receive the same payload", five.every((d) => d && d.id === "e1"));

  // A different key is a different entry — it must hit the network.
  await Q.dedupedFetch('["event","e2"]', "/events/e2");
  eq("a different key issues its own request", net.calls.length, 2);

  // Once settled the in-flight promise is cleared, so a later caller refetches.
  await Q.dedupedFetch('["event","e1"]', "/events/e1");
  eq("after settle, the next caller refetches", net.calls.length, 3);
  eq("handler ran once per network request", resolves, 3);

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Retry policy (§30)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("4. Retry policy (§30)");

  function httpError(status) {
    const e = new Error(`HTTP ${status}`);
    e.response = { status, data: {} };
    return e;
  }

  ok("network error (no response) is retryable", Q.isRetryable(new Error("Network Error")));
  ok("500 is retryable", Q.isRetryable(httpError(500)));
  ok("502 is retryable", Q.isRetryable(httpError(502)));
  ok("503 is retryable", Q.isRetryable(httpError(503)));
  ok("408 (timeout) is retryable", Q.isRetryable(httpError(408)));
  ok("429 (rate limited) is retryable", Q.isRetryable(httpError(429)));

  ok("400 is NOT retryable", !Q.isRetryable(httpError(400)));
  ok("401 is NOT retryable", !Q.isRetryable(httpError(401)));
  ok("403 is NOT retryable", !Q.isRetryable(httpError(403)));
  ok("404 is NOT retryable", !Q.isRetryable(httpError(404)));
  ok("409 is NOT retryable", !Q.isRetryable(httpError(409)));
  ok("422 is NOT retryable", !Q.isRetryable(httpError(422)));

  const cancelled = new Error("canceled");
  cancelled.name = "CanceledError";
  cancelled.code = "ERR_CANCELED";
  ok("a cancelled request is detected", Q.isCancelled(cancelled));
  ok("a cancelled request is NOT retryable", !Q.isRetryable(cancelled));

  const aborted = new Error("aborted");
  aborted.code = "ECONNABORTED";
  ok("an aborted request is NOT retryable", !Q.isRetryable(aborted));

  // backoff: exponential ceiling, fully jittered, capped at max
  const samples = Array.from({ length: 60 }, () => Q.backoffMs(3, 100, 1000));
  ok("backoff never exceeds the cap", Math.max(...samples) <= 1000);
  ok("backoff is jittered (not a fixed value)", new Set(samples).size > 1);
  ok("backoff ceiling grows with the attempt",
    Math.max(...Array.from({ length: 60 }, () => Q.backoffMs(4, 100, 10_000))) >
    Math.max(...Array.from({ length: 60 }, () => Q.backoffMs(1, 100, 10_000))));
  ok("backoff is never negative", samples.every((n) => n >= 0));

  // fetchWithRetry: transient failure is retried, permanent is not
  net.reset(() => {
    throw httpError(500);
  });
  let attempts500 = 0;
  net.reset(() => {
    attempts500++;
    throw httpError(500);
  });
  await Q.fetchWithRetry("/boom", { retries: 2 }).then(
    () => ok("500 eventually rejects", false),
    () => ok("500 eventually rejects", true)
  );
  eq("500 retried retries+1 times (1 initial + 2 retries)", attempts500, 3);

  let attempts404 = 0;
  net.reset(() => {
    attempts404++;
    throw httpError(404);
  });
  await Q.fetchWithRetry("/missing", { retries: 2 }).then(
    () => ok("404 rejects", false),
    () => ok("404 rejects", true)
  );
  eq("404 is NOT retried (1 attempt only)", attempts404, 1);

  // transient-then-success
  let n = 0;
  net.reset(() => {
    n++;
    if (n < 3) throw httpError(503);
    return { ok: true };
  });
  const recovered = await Q.fetchWithRetry("/flaky", { retries: 3 });
  ok("recovers after transient failures", recovered && recovered.ok === true);
  eq("recovered on the 3rd attempt", n, 3);

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. Prefetch (§17)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("5. Prefetch (§17)");

  Q.queryClient.clear();
  net.reset(async () => ({ id: "e9", title: "Warmed" }));

  await Q.queryClient.prefetchQuery(["event", "e9"], "/events/slug/e9");
  eq("prefetch stores the payload in cache", Q.queryClient.getQueryData(["event", "e9"]).title, "Warmed");
  eq("prefetch cost one request", net.calls.length, 1);

  // A second prefetch while fresh must be a no-op (this is what makes hover safe).
  await Q.queryClient.prefetchQuery(["event", "e9"], "/events/slug/e9");
  eq("a fresh key is not re-prefetched", net.calls.length, 1);

  // After invalidation it warms again.
  Q.queryClient.invalidateQueries(["event", "e9"]);
  await Q.queryClient.prefetchQuery(["event", "e9"], "/events/slug/e9");
  eq("an invalidated key is re-prefetched", net.calls.length, 2);

  // A failing prefetch must never throw (§61 — no error surfaces from a warm-up).
  net.reset(() => {
    throw httpError(500);
  });
  let prefetchThrew = false;
  await Q.queryClient.prefetchQuery(["event", "bad"], "/events/slug/bad").catch(() => (prefetchThrew = true));
  ok("a failed prefetch does not reject", !prefetchThrew);

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. Idempotency (§28)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("6. Idempotency (§28)");

  Q.queryClient.clear();
  net.reset(async () => ({ id: "reg1" }));

  const idemKey = "reg:evt-1:user-1:1700000000000";
  await Q.idempotentPost("/registration", { eventId: "evt-1" }, idemKey);
  const sent = net.calls[net.calls.length - 1];
  eq("Idempotency-Key header is attached", sent.headers["Idempotency-Key"], idemKey);
  eq("the request is a POST", sent.method, "post");

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. Frontend wiring audit
   * ══════════════════════════════════════════════════════════════════════ */

  sec("7. Frontend wiring audit");

  function walk(dir, ext, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, ext, acc);
      else if (ext.some((x) => e.name.endsWith(x))) acc.push(p);
    }
    return acc;
  }

  const tsFiles = walk(SRC, [".ts", ".tsx"]);
  ok("the app tree is walkable", tsFiles.length > 100, `${tsFiles.length} files`);
  const read = (p) => fs.readFileSync(p, "utf8");

  // §6 — no fixed-interval network polling outside the data layer.
  const timers = [];
  for (const f of tsFiles) {
    if (f.endsWith(path.join("lib", "query.ts"))) continue;
    const src = read(f);
    src.split("\n").forEach((line, i) => {
      if (/setInterval\s*\(/.test(line)) timers.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  // components/live/timer.tsx is a local 250ms countdown — no network involved.
  const networkTimers = timers.filter((t) => !t.startsWith(path.join("components", "live", "timer.tsx")));
  ok("no fixed-interval polling loops remain outside the data layer",
    networkTimers.length === 0, networkTimers.join(" | "));

  // Full-document reloads used for in-app navigation (§6).
  const reloading = [];
  for (const f of tsFiles) {
    const src = read(f);
    src.split("\n").forEach((line, i) => {
      if (/window\.location\s*\.\s*(href|assign|replace)\s*=/.test(line)) {
        reloading.push(`${path.relative(SRC, f)}:${i + 1}`);
      }
    });
  }
  // The OAuth entry points legitimately need a real navigation (they leave the SPA).
  const oauthOk = reloading.every((r) => /login-form|signup-form|verify-email-client/.test(r));
  ok("no in-app navigation triggers a full document reload",
    reloading.length === 0 || oauthOk, reloading.join(" | "));

  // §17 — the hover prefetch key and the detail-screen query key must agree,
  // otherwise prefetching warms a key nothing ever reads.
  const card = read(path.join(SRC, "components", "event-card.tsx"));
  const detail = read(path.join(SRC, "app", "(app)", "events", "[slug]", "page.tsx"));
  ok("EventCard prefetches the /events/slug/:slug endpoint",
    /\/events\/slug\/\$\{/.test(card));
  ok("event detail reads the same endpoint via useQuery",
    /useQuery</.test(detail) && /\/events\/slug\/\$\{/.test(detail));
  ok("both sides use the [\"event\", slug] cache key",
    /\["event",\s*slug\s*\]/.test(detail) && /\["event",\s*slug/.test(card));

  // The feed must be cursor-paginated, not offset-paginated (§7).
  const feed = read(path.join(SRC, "components", "feed", "feed-view.tsx"));
  ok("the feed uses useInfiniteQuery", /useInfiniteQuery</.test(feed));
  ok("the feed passes a cursor to the API", /p\.set\(\s*"cursor"/.test(feed));
  ok("the feed maps the { posts, hasMore, nextCursor } envelope", /mapPage/.test(feed) && /raw\?\.posts/.test(feed));

  // The data layer must be the only place that owns raw network calls in the
  // components we migrated.
  ok("feed no longer hand-rolls its pagination state", !/setNextCursor/.test(feed));
  ok("feed no longer calls api.get(\"/posts/feed\") directly", !/api\s*\n?\s*\.get\("\/posts\/feed"/.test(feed));

  /* ═══════════════════════════════════════════════════════════════════════
   * 8. Adaptive polling (§51)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("8. Adaptive polling (§51)");

  for (const f of [
    path.join("app", "(app)", "messages", "page.tsx"),
    path.join("components", "notifications", "notification-bell.tsx"),
    path.join("components", "shell", "messages-link.tsx"),
    path.join("app", "(app)", "quiz", "[id]", "page.tsx"),
  ]) {
    const src = read(path.join(SRC, f));
    ok(`${f} uses adaptive polling`, /usePolling\(/.test(src));
    ok(`${f} declares a ceiling interval`, /maxIntervalMs/.test(src));
  }

  const poll = read(path.join(SRC, "lib", "query.ts"));
  ok("polling pauses while the tab is hidden", /document\.hidden/.test(poll));
  ok("polling refreshes immediately when the tab returns visible",
    /visibilitychange/.test(poll));
  ok("polling reports change so the interval can stretch", /reportResult/.test(poll));

  /* ── summary ──────────────────────────────────────────────────────────── */

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  Phase 5 selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`   • ${f}`));
  }
  console.log(`${"═".repeat(64)}\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
