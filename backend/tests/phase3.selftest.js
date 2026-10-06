/**
 * PHASE 3 SELF-TEST (Part 5) — database layer, pagination, caching, batching.
 *
 *   node tests/phase3.selftest.js
 *
 * Runs against a real (in-memory) MongoDB so the fixes are PROVEN, not just
 * asserted from source. Every performance claim below is verified by counting
 * the actual database commands Mongoose issues.
 *
 *   1. §7  cursor primitives — MAX_LIMIT enforced, opaque cursors, paging
 *   2. §63 regex + query-length hardening
 *   3. §62 streaming CSV escaping (incl. formula-injection guard)
 *   4. §7  registrations are BOUNDED (was CRITICAL unbounded read)
 *   5. §41 server-side participant search + status filter
 *   6. §36 countsBatch: ONE aggregation for N events (was 2N queries)
 *   7. §40 statsByEvent: ONE $facet aggregation (was 5 queries)
 *   8. §40 export streams in bounded batches (never all rows at once)
 *   9. §35 feed context resolved ONCE per user, then cached
 *  10. §9  public event lookups hit the cache — 0 DB queries on a hit
 *  11. §10 private events are NEVER cached
 *  12. §13 invalidation actually evicts
 *  13. static audit — no unbounded finds left in the touched controllers
 */
process.env.NODE_ENV = "test";

const assert = require("assert");
const path = require("path");
const fs = require("fs");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err && err.stack ? err.stack.split("\n").slice(0, 4).join("\n     ") : err}`);
  }
}
function section(t) {
  console.log(`\n═══ ${t} ═══`);
}

/* ── Query counting ───────────────────────────────────────────
 * Mongoose's debug hook fires for every operation it issues, which is how we
 * prove "1 query" claims instead of hoping. */
const mongoose = require("mongoose");
let ops = [];
function startCounting() {
  ops = [];
  mongoose.set("debug", (collection, method) => ops.push(`${collection}.${method}`));
}
function stopCounting() {
  mongoose.set("debug", false);
  return ops.slice();
}

/* ── Modules under test ──────────────────────────────────── */
const { cursor } = require("../repositories");
const { RegistrationRepository } = require("../repositories/registration.repository");
const { PostRepository } = require("../repositories/post.repository");
const { EventRepository } = require("../repositories/event.repository");
const { cache, keys } = require("../services/cache.service");
const { escapeRegex, clampQuery } = require("../utils/regex");
const { csvCell, csvRow } = require("../utils/csv-stream");

const User = require("../models/user.model");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Follow = require("../models/follow.model");
const { MongoMemoryServer } = require("mongodb-memory-server");

(async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  /* ══════════════════════════════════════════════════════════
   * 1. Cursor primitives (§7)
   * ══════════════════════════════════════════════════════ */
  section("1. Cursor primitives (§7)");

  await test("MAX_LIMIT is 100 and can never be exceeded", () => {
    assert.strictEqual(cursor.MAX_LIMIT, 100);
    assert.strictEqual(cursor.parseLimit(1000), 100, "1000 must clamp to 100");
    assert.strictEqual(cursor.parseLimit(99999), 100);
    assert.strictEqual(cursor.parseLimit(100), 100);
  });

  await test("invalid / absent limits fall back to the default", () => {
    assert.strictEqual(cursor.parseLimit(undefined), 20);
    assert.strictEqual(cursor.parseLimit("abc"), 20);
    assert.strictEqual(cursor.parseLimit(-5), 20);
    assert.strictEqual(cursor.parseLimit(0), 20);
    assert.strictEqual(cursor.parseLimit("25"), 25);
  });

  await test("a domain may lower the ceiling but never raise it", () => {
    assert.strictEqual(cursor.parseLimit(80, { max: 50 }), 50);
    assert.strictEqual(cursor.parseLimit(9999, { max: 200 }), 100, "cannot exceed global max");
  });

  await test("cursors are opaque, round-trip, and reject tampering", () => {
    const encoded = cursor.encodeCursor({ at: "2026-01-01T00:00:00.000Z", id: "abc123" });
    assert.ok(!encoded.includes("abc123"), "cursor must not leak raw ids in plaintext");
    assert.deepStrictEqual(cursor.decodeCursor(encoded), { at: "2026-01-01T00:00:00.000Z", id: "abc123" });
    assert.strictEqual(cursor.decodeCursor("!!!!not-base64!!!!"), null);
    assert.strictEqual(cursor.decodeCursor(null), null);
  });

  await test("buildPage over-fetches by one to derive hasMore, then trims", () => {
    const rows = [{ _id: "a", createdAt: 3 }, { _id: "b", createdAt: 2 }, { _id: "c", createdAt: 1 }];
    const page = cursor.buildPage(rows, 2);
    assert.strictEqual(page.items.length, 2, "must never return more than `limit`");
    assert.strictEqual(page.hasMore, true);
    assert.ok(page.nextCursor, "a full page must produce a next cursor");

    const last = cursor.buildPage(rows.slice(0, 1), 2);
    assert.strictEqual(last.hasMore, false);
    assert.strictEqual(last.nextCursor, null, "no next page → no cursor");
  });

  await test("keysetFilter builds a stable (createdAt,_id) descending predicate", () => {
    const c = cursor.encodeCursor({ at: "2026-01-01T00:00:00.000Z", id: "507f1f77bcf86cd799439011" });
    const f = cursor.keysetFilter(c);
    assert.ok(f.$or, "expected an $or keyset");
    assert.ok(f.$or[0].createdAt.$lt instanceof Date);
    assert.ok(f.$or[1]._id.$lt, "_id tiebreaker keeps pagination stable");
    assert.strictEqual(cursor.keysetFilter("garbage"), null, "bad cursor → first page, not an error");
  });

  /* ══════════════════════════════════════════════════════════
   * 2. Regex + input limits (§63)
   * ══════════════════════════════════════════════════════ */
  section("2. Regex + input limits (§63)");

  await test("escapeRegex neutralises every metacharacter", () => {
    assert.strictEqual(escapeRegex("a.*b"), "a\\.\\*b");
    assert.doesNotThrow(() => new RegExp(escapeRegex("((((a+)+)+)+$")));
    assert.strictEqual(new RegExp(`^${escapeRegex("a.c")}$`).test("a.c"), true);
    assert.strictEqual(new RegExp(`^${escapeRegex("a.c")}$`).test("abc"), false);
  });

  await test("clampQuery caps the search string", () => {
    assert.strictEqual(clampQuery("x".repeat(5000)).length, 100);
    assert.strictEqual(clampQuery("  hello  "), "hello");
  });

  /* ══════════════════════════════════════════════════════════
   * 3. Streaming CSV (§40, §62)
   * ══════════════════════════════════════════════════════ */
  section("3. Streaming CSV (§40, §62)");

  await test("cells with commas/quotes/newlines are quoted correctly", () => {
    assert.strictEqual(csvCell("a,b"), '"a,b"');
    assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""');
    assert.strictEqual(csvCell("line\nbreak"), '"line\nbreak"');
    assert.strictEqual(csvCell(null), "");
    assert.strictEqual(csvCell(undefined), "");
  });

  await test("§62 spreadsheet formula injection is neutralised", () => {
    assert.ok(csvCell("=SUM(A1:A9)").startsWith("'"), "leading = must be defused");
    assert.ok(csvCell("+1234").startsWith("'"));
    assert.ok(csvCell("@evil").startsWith("'"));
    assert.ok(csvCell("-2+3").startsWith("'"));
    assert.strictEqual(csvCell("Normal name"), "Normal name", "ordinary text untouched");
  });

  await test("booleans and objects serialise predictably", () => {
    assert.strictEqual(csvCell(true), "Yes");
    assert.strictEqual(csvCell(false), "No");
    assert.strictEqual(csvCell({ a: 1 }), '"{""a"":1}"', "JSON with commas is quoted");
    assert.strictEqual(csvRow(["a", "b"]), "a,b\r\n");
  });

  /* ══════════════════════════════════════════════════════════
   * 4–8. Registration repository (integration, real MongoDB)
   * ══════════════════════════════════════════════════════ */
  section("4–8. Registration repository (live MongoDB)");

  // Seed: 250 users, 1 event, 250 registrations.
  // One registration per user — RegistrationResponse enforces a unique
  // {eventId, userId} index, so the realistic fixture is N users × 1 event.
  const TOTAL = 250;
  const NAMES = ["Ada", "Grace", "Alan"];
  const stamp = Date.now();
  const userDocs = [];
  for (let i = 0; i < TOTAL; i++) {
    userDocs.push({
      firstName: NAMES[i] || `User${i}`,
      lastName: "Tester" + i,
      username: `tester${i}_${stamp}`,
      email: `t${i}_${stamp}@example.com`,
      passwordHash: "x",
      profile: { institution: "IIT", course: "CS", year: "3" },
    });
  }
  const users = await User.insertMany(userDocs);
  const event = await Event.create({
    title: "Phase 3 Test Event",
    slug: "phase3-test-event-" + Date.now(),
    description: "d",
    venue: "Test Venue",
    startDate: new Date(Date.now() + 86400000),
    endDate: new Date(Date.now() + 172800000),
    visibility: "public",
    registrationForm: [{ label: "T-Shirt Size", type: "text" }],
  });

  const docs = [];
  for (let i = 0; i < TOTAL; i++) {
    docs.push({
      eventId: event._id,
      userId: users[i]._id,
      answers: [{ fieldLabel: "T-Shirt Size", fieldType: "text", value: i % 2 ? "LARGE-XL" : "MEDIUM-M" }],
      status: i % 5 === 0 ? "pending" : "confirmed",
      createdAt: new Date(Date.now() - i * 1000),
    });
  }
  await RegistrationResponse.insertMany(docs);
  const eventId = String(event._id);

  await test("§7 the participant list is BOUNDED even when the client asks for 5000", async () => {
    const page = await RegistrationRepository.listByEvent({ eventId, limit: 5000 });
    assert.ok(
      page.items.length <= cursor.MAX_LIMIT,
      `expected <= ${cursor.MAX_LIMIT} rows, got ${page.items.length}`
    );
    assert.strictEqual(page.items.length, 100, "an over-large limit clamps to MAX_LIMIT");
    assert.strictEqual(page.hasMore, true, "250 rows exist → more available");
  });

  await test("§7 cursor pagination walks every row exactly once, no dupes, no gaps", async () => {
    const seen = new Set();
    let cursorToken = null;
    let pages = 0;
    do {
      const page = await RegistrationRepository.listByEvent({ eventId, limit: 40, cursor: cursorToken });
      for (const row of page.items) {
        const id = String(row._id);
        assert.ok(!seen.has(id), "duplicate row across pages");
        seen.add(id);
      }
      cursorToken = page.nextCursor;
      pages += 1;
      assert.ok(pages < 50, "pagination did not terminate");
    } while (cursorToken);

    assert.strictEqual(seen.size, TOTAL, `expected all ${TOTAL} rows, walked ${seen.size}`);
    assert.strictEqual(pages, Math.ceil(TOTAL / 40), "expected one extra page-flip");
  });

  await test("§6 rows carry only projected fields (no unbounded nested data)", async () => {
    const page = await RegistrationRepository.listByEvent({ eventId, limit: 3 });
    const row = page.items[0];
    assert.ok(row.userId, "user is populated");
    assert.ok(row.userId.firstName !== undefined, "name present for the table");
    // The projection must not drag the whole user document along.
    assert.strictEqual(row.userId.passwordHash, undefined, "passwordHash must never be projected");
    assert.strictEqual(row.metadata, undefined, "metadata is not needed by the table");
  });

  await test("§41 server-side search matches a participant by name", async () => {
    const page = await RegistrationRepository.listByEvent({ eventId, q: "Ada", limit: 100 });
    assert.ok(page.items.length > 0, "search by first name must return rows");
    for (const r of page.items) {
      assert.strictEqual(r.userId.firstName, "Ada");
    }
  });

  await test("§41 search by email works and is bounded", async () => {
    const email = users[1].email;
    const page = await RegistrationRepository.listByEvent({ eventId, q: email, limit: 100 });
    assert.ok(page.items.length > 0);
    assert.ok(page.items.every((r) => r.userId.email === email));
  });

  await test("§41 a query matching nothing returns nothing (not everything)", async () => {
    const page = await RegistrationRepository.listByEvent({
      eventId,
      q: "zzzz-no-such-person-zzzz",
      limit: 100,
    });
    assert.strictEqual(page.items.length, 0, "must not fall back to returning all rows");
  });

  await test("§41 status filter is applied server-side", async () => {
    const page = await RegistrationRepository.listByEvent({ eventId, status: "pending", limit: 100 });
    assert.ok(page.items.length > 0);
    assert.ok(page.items.every((r) => r.status === "pending"));
  });

  await test("§41 search matches custom answer values", async () => {
    const page = await RegistrationRepository.listByEvent({ eventId, q: "LARGE", limit: 5 });
    assert.ok(page.items.length > 0, "answer values are searchable");
    assert.ok(
      page.items.every((r) => r.answers.some((a) => String(a.value).includes("LARGE"))),
      "every hit actually contains the search term in an answer"
    );
  });

  await test("§36 countsBatch resolves N events in ONE aggregation (was 2N queries)", async () => {
    // A second event with no registrations, to prove zero-fill works.
    const empty = await Event.create({
      title: "Empty Event",
      slug: "phase3-empty-" + Date.now(),
      description: "d",
      venue: "Test Venue",
      venue: "Test Venue",
      startDate: new Date(),
      endDate: new Date(),
      visibility: "public",
    });
    RegistrationRepository.invalidateEvent(eventId);

    startCounting();
    const counts = await RegistrationRepository.countsBatch([
      eventId,
      String(empty._id),
      "not-an-objectid",
    ]);
    const used = stopCounting();

    assert.strictEqual(counts[eventId], TOTAL, "count for the seeded event");
    assert.strictEqual(counts[String(empty._id)], 0, "unknown/zero events report 0");
    assert.strictEqual(counts["not-an-objectid"], undefined, "invalid ids are ignored, not counted");
    assert.strictEqual(
      used.length,
      1,
      `expected exactly 1 database operation for 3 ids, issued ${used.length}: ${used.join(", ")}`
    );
    assert.ok(used[0].includes("aggregate"), `expected an aggregate, got ${used[0]}`);
  });

  await test("§36 countsBatch still costs ONE query as the id list grows", async () => {
    const extras = [];
    for (let i = 0; i < 20; i++) {
      extras.push(
        await Event.create({
          title: `E${i}`,
          slug: `phase3-bulk-${Date.now()}-${i}`,
          description: "d",
          venue: "Test Venue",
          startDate: new Date(),
          endDate: new Date(),
          visibility: "public",
        })
      );
    }
    cache.flush(); // ensure a cold read so we measure the real query, not cache
    startCounting();
    await RegistrationRepository.countsBatch([eventId, ...extras.map((e) => String(e._id))]);
    const used = stopCounting();
    assert.strictEqual(
      used.length,
      1,
      `21 event ids must stay at 1 query, issued ${used.length}: ${used.join(", ")}`
    );
  });

  await test("§37 a repeated single-event count is served from cache (0 queries)", async () => {
    RegistrationRepository.invalidateEvent(eventId);
    startCounting();
    const first = await RegistrationRepository.countByEvent(eventId);
    const cold = stopCounting();

    startCounting();
    const second = await RegistrationRepository.countByEvent(eventId);
    const warm = stopCounting();

    assert.strictEqual(first, TOTAL);
    assert.strictEqual(second, TOTAL, "cached value must be identical");
    assert.ok(cold.length >= 1, "cold read hits the database");
    assert.strictEqual(warm.length, 0, `warm read must be 0 queries, issued ${warm.length}`);
  });

  await test("§13 invalidation evicts the cached count", async () => {
    await RegistrationRepository.countByEvent(eventId); // prime
    RegistrationRepository.invalidateEvent(eventId);
    startCounting();
    await RegistrationRepository.countByEvent(eventId);
    const used = stopCounting();
    assert.ok(used.length >= 1, "after invalidation the count must be recomputed");
  });

  await test("§40 statsByEvent uses ONE $facet aggregation (was 5 queries)", async () => {
    RegistrationRepository.invalidateEvent(eventId);
    startCounting();
    const stats = await RegistrationRepository.statsByEvent(eventId);
    const used = stopCounting();

    assert.strictEqual(stats.totalRegistrations, TOTAL);
    assert.strictEqual(stats.confirmedRegistrations, TOTAL - Math.ceil(TOTAL / 5));
    assert.strictEqual(stats.pendingRegistrations, Math.ceil(TOTAL / 5));
    assert.ok(stats.registrationRate > 0 && stats.registrationRate <= 100);
    assert.ok(Array.isArray(stats.dailyRegistrations));
    assert.ok(stats.sourceBreakdown, "source breakdown present");
    assert.strictEqual(
      used.length,
      1,
      `expected 1 aggregation, issued ${used.length}: ${used.join(", ")}`
    );
  });

  await test("§40 export streams ALL rows in bounded batches (never one giant read)", async () => {
    let received = 0;
    let maxBatch = 0;
    for await (const batch of RegistrationRepository.iterateByEvent({ eventId, batchSize: 50 })) {
      maxBatch = Math.max(maxBatch, batch.length);
      received += batch.length;
    }
    assert.strictEqual(received, TOTAL, "stream must yield every registration exactly once");
    assert.ok(maxBatch <= 50, `batch must stay bounded, saw ${maxBatch}`);
  });

  await test("§40 export memory is O(batch) even for a large event", async () => {
    // Default batch is 200; assert we never materialise all 250 at once.
    let maxBatch = 0;
    for await (const batch of RegistrationRepository.iterateByEvent({ eventId })) {
      maxBatch = Math.max(maxBatch, batch.length);
    }
    assert.ok(maxBatch <= 200, `default batch must be bounded, saw ${maxBatch}`);
  });

  await test("§5 listUserEvents is paginated and projects only card fields", async () => {
    const page = await RegistrationRepository.listUserEvents({ userId: users[0]._id, limit: 10 });
    assert.ok(page.items.length <= 10);
    assert.ok(Array.isArray(page.events), "legacy `events` alias kept for old clients");
    if (page.events.length) {
      const ev = page.events[0];
      assert.ok(ev.title, "event summary present");
      assert.strictEqual(ev.checkIns, undefined, "heavy nested arrays must not be hydrated");
    }
  });

  /* ══════════════════════════════════════════════════════════
   * 9. Feed context (§35)
   * ══════════════════════════════════════════════════════ */
  section("9. Feed context caching (§35)");

  const viewer = users[0];
  await Follow.create({ follower: viewer._id, followee: users[1]._id, status: "accepted" });
  await Follow.create({ follower: viewer._id, followee: users[2]._id, status: "accepted" });

  await test("the social graph is loaded ONCE, then served from cache", async () => {
    PostRepository.invalidateFeedContext(viewer._id);

    startCounting();
    const cold = await PostRepository.getFeedContext(viewer._id);
    const coldOps = stopCounting();

    startCounting();
    const warm = await PostRepository.getFeedContext(viewer._id);
    const warmOps = stopCounting();

    assert.strictEqual(cold.following.length, 2, "two accepted follows");
    assert.deepStrictEqual(warm.following, cold.following, "warm context identical");
    assert.ok(coldOps.length >= 1, "cold load queries the database");
    assert.strictEqual(
      warmOps.length,
      0,
      `warm load must issue 0 queries, issued ${warmOps.length}: ${warmOps.join(", ")}`
    );
  });

  await test("§10 the context cache key carries the user identity", () => {
    const a = keys.followList("user-aaa");
    const b = keys.followList("user-bbb");
    assert.notStrictEqual(a, b, "different users must never share a key");
    assert.ok(a.includes("user-aaa"));
  });

  await test("§13 follow changes invalidate the feed context", async () => {
    await PostRepository.getFeedContext(viewer._id); // prime
    PostRepository.invalidateFeedContext(viewer._id);
    startCounting();
    await PostRepository.getFeedContext(viewer._id);
    const used = stopCounting();
    assert.ok(used.length >= 1, "after invalidation the graph must be reloaded");
  });

  await test("§10 an anonymous viewer gets an empty, query-free context", async () => {
    startCounting();
    const ctx = await PostRepository.getFeedContext(null);
    const used = stopCounting();
    assert.deepStrictEqual(ctx.following, []);
    assert.strictEqual(ctx.isAnon, true);
    assert.strictEqual(used.length, 0, "anonymous context must not touch the database");
  });

  await test("visibilityFilter is pure — derived from context, no queries", async () => {
    const ctx = await PostRepository.getFeedContext(viewer._id);
    startCounting();
    const f1 = PostRepository.visibilityFilter(ctx, viewer._id);
    const f2 = PostRepository.visibilityFilter(ctx, viewer._id);
    const used = stopCounting();
    assert.deepStrictEqual(f1, f2, "same context → same filter (deterministic)");
    assert.ok(f1.$or.length >= 4, "public / followers / event / community / own");
    assert.strictEqual(used.length, 0, "building the filter must not query");
  });

  /* ══════════════════════════════════════════════════════════
   * 10–12. Event repository caching (§9, §10, §13)
   * ══════════════════════════════════════════════════════ */
  section("10–12. Event cache (§9, §10, §13)");

  await test("§9 a warm public event lookup costs ZERO database queries", async () => {
    await EventRepository.invalidate(event);
    startCounting();
    const first = await EventRepository.publicBySlug(event.slug);
    const cold = stopCounting();

    startCounting();
    const second = await EventRepository.publicBySlug(event.slug);
    const warm = stopCounting();

    assert.ok(first && first.title === "Phase 3 Test Event");
    assert.strictEqual(second.title, first.title);
    assert.ok(cold.length >= 1, "cold lookup queries the database");
    assert.strictEqual(
      warm.length,
      0,
      `warm lookup must be 0 queries, issued ${warm.length}: ${warm.join(", ")}`
    );
  });

  await test("§9 the cached public projection strips sensitive fields", async () => {
    const pub = await EventRepository.publicBySlug(event.slug);
    assert.strictEqual(pub.ticketSettings, undefined, "ticketSettings must not be cached/served");
    assert.strictEqual(pub.passcode, undefined);
    assert.strictEqual(pub.meetingId, undefined);
    assert.ok(pub.title, "public fields survive");
  });

  await test("§13 updating an event evicts its cached public page", async () => {
    await EventRepository.publicBySlug(event.slug); // prime
    EventRepository.invalidate(event);
    startCounting();
    await EventRepository.publicBySlug(event.slug);
    const used = stopCounting();
    assert.ok(used.length >= 1, "after invalidation the event must be re-read");
  });

  await test("§10 PRIVATE events are never cached — every lookup re-reads", async () => {
    const priv = await Event.create({
      title: "Private Event",
      slug: "phase3-private-" + Date.now(),
      description: "d",
      venue: "Test Venue",
      startDate: new Date(),
      endDate: new Date(),
      visibility: "private",
      onlineEventLink: "https://secret.example.com",
    });

    startCounting();
    const a = await EventRepository.publicBySlug(priv.slug);
    const first = stopCounting();
    startCounting();
    const b = await EventRepository.publicBySlug(priv.slug);
    const second = stopCounting();

    assert.strictEqual(a.visibility, "private");
    assert.ok(first.length >= 1 && second.length >= 1, "private events must never be cache hits");
    assert.strictEqual(a.onlineEventLink, "https://secret.example.com", "not redacted for the organizer path");
    assert.strictEqual(b.visibility, "private");
  });

  await test("§9 a missing event is NOT cached as null (a later create resolves)", async () => {
    const slug = "phase3-not-yet-created";
    const before = await EventRepository.publicBySlug(slug);
    assert.strictEqual(before, null);

    await Event.create({
      title: "Appeared Later",
      slug,
      description: "d",
      venue: "Test Venue",
      venue: "Test Venue",
      startDate: new Date(),
      endDate: new Date(),
      visibility: "public",
    });

    const after = await EventRepository.publicBySlug(slug);
    assert.ok(after && after.title === "Appeared Later", "must not be shadowed by a cached null");
  });

  /* ══════════════════════════════════════════════════════════
   * 13. Static audit — the fixes are actually wired into controllers
   * ══════════════════════════════════════════════════════ */
  section("13. Static wiring audit");

  const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  const regCtrl = read("controllers/registration.controller.js");
  const postCtrl = read("controllers/post.controller.js");
  const eventCtrl = read("controllers/event.controller.js");

  await test("registration controller no longer performs an unbounded find", () => {
    assert.ok(
      !/\.find\(\{\s*eventId\s*\}\)/.test(regCtrl),
      "raw unbounded `find({ eventId })` must be gone"
    );
    assert.ok(regCtrl.includes("RegistrationRepository.listByEvent"), "must use the repository");
  });

  await test("CSV export streams instead of buffering the whole file", () => {
    assert.ok(regCtrl.includes("streamCsv"), "must use the streaming writer");
    assert.ok(
      !/json2csvParser\.parse\(jsonData\)/.test(regCtrl),
      "in-memory CSV parse must be gone"
    );
    assert.ok(regCtrl.includes("iterateByEvent"), "must iterate in batches");
  });

  await test("batch counts go through the single-aggregation repository", () => {
    assert.ok(regCtrl.includes("RegistrationRepository.countsBatch"));
    assert.ok(!regCtrl.includes("Event.exists({ _id: eventId })"), "per-event exists() removed");
  });

  await test("the feed no longer re-queries the follow list or counts documents", () => {
    assert.ok(postCtrl.includes("PostRepository.getFeedContext"), "uses the cached context");
    assert.ok(!postCtrl.includes("Post.countDocuments(filter)"), "per-page count removed");
    assert.ok(
      postCtrl.includes("const hasMore = rows.length > limit"),
      "hasMore derived from the over-fetched slice"
    );
  });

  await test("public event detail is cache-first and invalidated on write", () => {
    assert.ok(eventCtrl.includes("EventRepository.publicBySlug"));
    assert.ok(eventCtrl.includes("EventRepository.invalidate(event)"));
    assert.ok(
      eventCtrl.includes("const toPublicEvent = EventRepository.toPublicEvent"),
      "single source of truth for the public projection"
    );
  });

  await test("follow changes invalidate the feed context", () => {
    const followCtrl = read("controllers/follow.controller.js");
    assert.ok(followCtrl.includes("PostRepository.invalidateFeedContext"));
  });

  await test("no duplicate schema indexes remain (free-tier storage)", () => {
    // Inspect the COMPILED schema rather than source text: this is the real
    // list of indexes Mongoose will build, so it cannot be fooled by
    // commented-out code or formatting changes.
    const TicketModel = require("../models/ticket.model");
    const CommunityModel = require("../models/community.model");
    for (const [name, model] of [
      ["Event", Event],
      ["User", User],
      ["Ticket", TicketModel],
      ["Community", CommunityModel],
    ]) {
      const seen = new Set();
      for (const spec of model.schema.indexes()) {
        const key = JSON.stringify(spec[0]);
        assert.ok(!seen.has(key), `${name} declares a DUPLICATE index on ${key}`);
        seen.add(key);
      }
    }
  });

  /* ── teardown ── */
  await mongoose.disconnect();
  await mongo.stop();

  console.log("\n" + "═".repeat(52));
  console.log(`  PHASE 3 SELF-TEST: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52) + "\n");
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error("\n💥 Phase 3 selftest crashed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
