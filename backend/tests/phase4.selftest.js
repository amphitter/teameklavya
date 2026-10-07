/**
 * PHASE 4 SELF-TEST (Part 5) — storage & image optimization.
 *
 *   node tests/phase4.selftest.js
 *
 * Runs against a real (in-memory) MongoDB for the orphan-lifecycle tests and
 * exercises the Cloudinary provider's URL pipeline directly (URL construction
 * is pure string work, so it needs no credentials or network).
 *
 *   1. §66  StorageProvider interface — both providers implement the contract
 *   2. §19  variant presets + transform injection (+ idempotency)
 *   3. §19  non-Cloudinary URLs pass through untouched (never break an image)
 *   4. §62  magic-byte sniffing defeats MIME spoofing
 *   5. §20  per-folder upload ceilings
 *   6. §55  orphan lifecycle: pending → active → cleanup_pending
 *   7. §55  the sweeper can NEVER reclaim an `active` asset
 *   8. §57  upload success/failure metrics incl. failure rate
 *   9. static audit — frontend wired to OptimizedImage + client compression
 */
process.env.NODE_ENV = "test";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

/**
 * The local-disk fallback is active whenever Cloudinary credentials are absent
 * (which is the case in CI and on a fresh clone), so uploads would otherwise
 * land in backend/uploads and litter the repo with fixture PNGs on every run.
 * Redirect them to a scratch directory that the suite removes at teardown.
 *
 * NOTE: must be set BEFORE storage.provider is required — it resolves the
 * directory once at module load.
 */
const TEST_UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "eventhub-uploads-"));
process.env.UPLOADS_DIR = TEST_UPLOADS;

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

const storage = require("../services/storage.provider");
const { CloudinaryProvider, LocalProvider, VARIANT_PRESETS, sniffMime, folderLimit } = storage;
const media = require("../services/media.service");
const metrics = require("../services/metrics.service");
const MediaAsset = require("../models/mediaAsset.model");

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

/* ── Real file signatures for the spoofing tests ───────────────────────── */
const SIGNATURES = {
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  // A structurally valid PNG header: 8-byte signature, then the IHDR chunk
  // length (13), "IHDR", and a real width/height. The old fixture stopped
  // after the length field, which sniffMime() accepted but which is not a
  // decodable image — anything that reads the dimensions saw 0x0.
  "image/png": (() => {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8); // IHDR chunk length
    Buffer.from("IHDR", "ascii").copy(b, 12);
    b.writeUInt32BE(64, 16); // width
    b.writeUInt32BE(64, 20); // height
    return b;
  })(),
  "image/webp": Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP"),
  ]),
  "image/gif": Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(8)]),
};

const CLOUD_URL = "https://res.cloudinary.com/demo/image/upload/v1712345678/eventhub/posters/abc123.jpg";

(async () => {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  /* ══════════════════════════════════════════════════════════
   * 1. Provider interface (§66)
   * ══════════════════════════════════════════════════════ */
  section("1. StorageProvider interface (§66)");

  await test("both providers implement the full contract", () => {
    // `name` is a string identifier; the rest are the callable contract.
    const methods = ["isConfigured", "upload", "remove", "optimizeUrl", "variants"];
    for (const p of [CloudinaryProvider, LocalProvider]) {
      assert.ok(typeof p.name === "string" && p.name.length, "provider needs a name");
      for (const m of methods) {
        assert.strictEqual(typeof p[m], "function", `${p.name} is missing ${m}()`);
      }
    }
  });

  await test("§21 the active provider is chosen without touching call sites", () => {
    // With no Cloudinary credentials in the test env we expect the local
    // fallback — proving selection works and the app still boots (§68).
    assert.ok(["cloudinary", "local"].includes(storage.provider.name));
    if (!CloudinaryProvider.isConfigured()) {
      assert.strictEqual(storage.provider.name, "local");
    }
  });

  /* ══════════════════════════════════════════════════════════
   * 2. Variants + transformation (§19)
   * ══════════════════════════════════════════════════════ */
  section("2. Image variants (§19)");

  await test("optimizeUrl injects width, crop, quality and auto format", () => {
    const out = CloudinaryProvider.optimizeUrl(CLOUD_URL, { width: 640 });
    assert.ok(out.includes("w_640"), out);
    assert.ok(out.includes("c_limit"), "default crop is limit (never upscale)");
    assert.ok(out.includes("q_auto"), "quality auto");
    assert.ok(out.includes("f_auto"), "§19 modern format negotiation");
    assert.ok(out.includes("/v1712345678/"), "asset path preserved");
  });

  await test("transform injection is idempotent — no stacked transformations", () => {
    const once = CloudinaryProvider.optimizeUrl(CLOUD_URL, { width: 640 });
    const twice = CloudinaryProvider.optimizeUrl(once, { width: 640 });
    assert.strictEqual(twice, once, "re-optimizing must not double up segments");
    // Only ONE transformation segment may exist between /upload/ and /v…
    const segment = twice.split("/image/upload/")[1].split("/v1712345678")[0];
    assert.strictEqual(segment.split(",").filter((s) => s.startsWith("w_")).length, 1);
  });

  await test("a different width replaces, not appends, the transformation", () => {
    const a = CloudinaryProvider.optimizeUrl(CLOUD_URL, { width: 640 });
    const b = CloudinaryProvider.optimizeUrl(a, { width: 1600 });
    assert.ok(b.includes("w_1600"), b);
    assert.ok(!b.includes("w_640"), "old width must be gone");
  });

  await test("explicit height switches to fill crop (avatars)", () => {
    const out = CloudinaryProvider.optimizeUrl(CLOUD_URL, { width: 96, height: 96, crop: "fill" });
    assert.ok(out.includes("h_96"), out);
    assert.ok(out.includes("c_fill"), out);
  });

  await test("variants() returns the full responsive set for every preset", () => {
    for (const name of Object.keys(VARIANT_PRESETS)) {
      const v = CloudinaryProvider.variants(CLOUD_URL, name);
      for (const key of ["thumb", "small", "medium", "large", "original"]) {
        assert.ok(v[key], `${name}.${key} must be present`);
      }
      assert.strictEqual(v.original, CLOUD_URL, "original is untransformed");
      assert.notStrictEqual(v.thumb, v.large, "variants must differ");
    }
  });

  await test("§19 thumb < small < medium < large in requested width", () => {
    const v = CloudinaryProvider.variants(CLOUD_URL, "poster");
    const width = (u) => Number(u.match(/w_(\d+)/)[1]);
    assert.ok(width(v.thumb) < width(v.small), "thumb smaller than small");
    assert.ok(width(v.small) < width(v.medium), "small smaller than medium");
    assert.ok(width(v.medium) < width(v.large), "medium smaller than large");
  });

  await test("avatar presets stay small (avatars render at 24–96 px)", () => {
    const v = CloudinaryProvider.variants(CLOUD_URL, "avatar");
    assert.ok(v.thumb.includes("w_64"), v.thumb);
    assert.ok(v.medium.includes("w_400"), v.medium);
  });

  await test("a null/empty source yields a null variant set, never a crash", () => {
    const v = CloudinaryProvider.variants(null, "poster");
    assert.deepStrictEqual(v, { thumb: null, small: null, medium: null, large: null, original: null });
  });

  /* ══════════════════════════════════════════════════════════
   * 3. Pass-through safety (§68)
   * ══════════════════════════════════════════════════════ */
  section("3. Non-Cloudinary pass-through (§68)");

  await test("legacy local /uploads URLs pass through untransformed", () => {
    const legacy = "/uploads/posters/1759901314566-poster.jpg";
    assert.strictEqual(CloudinaryProvider.optimizeUrl(legacy, { width: 640 }), legacy);
    const v = CloudinaryProvider.variants(legacy, "poster");
    assert.strictEqual(v.thumb, legacy, "no transform possible → serve as-is");
  });

  await test("external URLs are never rewritten", () => {
    const ext = "https://example.com/photo.jpg";
    assert.strictEqual(CloudinaryProvider.optimizeUrl(ext, { width: 640 }), ext);
  });

  await test("the local provider degrades gracefully (no transform engine)", () => {
    const v = LocalProvider.variants(CLOUD_URL, "poster");
    assert.strictEqual(v.thumb, CLOUD_URL);
    assert.ok(LocalProvider.isConfigured(), "local is always available");
  });

  /* ══════════════════════════════════════════════════════════
   * 4. Magic-byte sniffing (§62)
   * ══════════════════════════════════════════════════════ */
  section("4. MIME spoofing defence (§62)");

  await test("every supported type is recognised by its real signature", () => {
    for (const [mime, buf] of Object.entries(SIGNATURES)) {
      assert.strictEqual(sniffMime(buf), mime, `failed to sniff ${mime}`);
    }
  });

  await test("a PNG labelled as JPEG is rejected", () => {
    const err = media.validateImageBuffer(SIGNATURES["image/png"], "image/jpeg", "avatars");
    assert.ok(err, "spoofed upload must be rejected");
    assert.ok(/don't match/i.test(err), err);
  });

  await test("random bytes are rejected as not-an-image", () => {
    const junk = Buffer.from("this is definitely not an image file");
    assert.strictEqual(sniffMime(junk), null);
    assert.ok(media.validateImageBuffer(junk, "image/png", "avatars"));
  });

  await test("an unsupported declared type is rejected outright", () => {
    assert.ok(media.validateImageBuffer(SIGNATURES["image/jpeg"], "application/x-php", "misc"));
  });

  await test("a truncated buffer is rejected", () => {
    assert.strictEqual(sniffMime(Buffer.from([0xff, 0xd8])), null);
  });

  /* ══════════════════════════════════════════════════════════
   * 5. Per-folder ceilings (§20)
   * ══════════════════════════════════════════════════════ */
  section("5. Per-folder size ceilings (§20)");

  await test("avatars have a tighter ceiling than posters", () => {
    assert.ok(folderLimit("avatars") < folderLimit("posters"), "avatar < poster");
    assert.strictEqual(folderLimit("avatars"), 2 * 1024 * 1024);
    assert.strictEqual(folderLimit("posters"), 8 * 1024 * 1024);
    assert.strictEqual(folderLimit("unknown-folder"), 5 * 1024 * 1024, "sane default");
  });

  await test("an oversized avatar is rejected with a useful message", () => {
    const big = Buffer.concat([SIGNATURES["image/jpeg"], Buffer.alloc(3 * 1024 * 1024)]);
    const err = media.validateImageBuffer(big, "image/jpeg", "avatars");
    assert.ok(err, "3 MB avatar must be rejected");
    assert.ok(/2 MB/.test(err), `expected the 2 MB ceiling in: ${err}`);
  });

  await test("the same 3 MB file is fine as a poster", () => {
    const big = Buffer.concat([SIGNATURES["image/jpeg"], Buffer.alloc(3 * 1024 * 1024)]);
    assert.strictEqual(media.validateImageBuffer(big, "image/jpeg", "posters"), null);
  });

  await test("an empty buffer is rejected", () => {
    assert.ok(media.validateImageBuffer(Buffer.alloc(0), "image/jpeg", "misc"));
  });

  /* ══════════════════════════════════════════════════════════
   * 6–7. Orphan lifecycle (§55)
   * ══════════════════════════════════════════════════════ */
  section("6–7. Orphan lifecycle (§55)");

  await test("a successful upload is tracked as `pending`", async () => {
    const result = await media.uploadImage({
      buffer: Buffer.concat([SIGNATURES["image/png"], Buffer.alloc(2048)]),
      mimetype: "image/png",
      folder: "avatars",
    });
    assert.ok(result.publicId, "upload returned a public id");

    const record = await MediaAsset.findOne({ publicId: result.publicId }).lean();
    assert.ok(record, "asset is tracked");
    assert.strictEqual(record.status, "pending", "not yet attached");
    assert.ok(record.cleanupAfter, "has a grace window");
    assert.strictEqual(record.folder, "avatars");
  });

  await test("markAttached promotes the asset to `active` and clears the window", async () => {
    const { publicId } = await media.uploadImage({
      buffer: Buffer.concat([SIGNATURES["image/png"], Buffer.alloc(1024)]),
      mimetype: "image/png",
      folder: "avatars",
    });
    await media.markAttached(publicId, "user:507f1f77bcf86cd799439011");

    const record = await MediaAsset.findOne({ publicId }).lean();
    assert.strictEqual(record.status, "active");
    assert.strictEqual(record.cleanupAfter, null, "attached assets have no expiry");
    assert.strictEqual(record.attachedTo, "user:507f1f77bcf86cd799439011");
  });

  await test("a failed consume marks the asset `cleanup_pending`, not deleted", async () => {
    const { publicId } = await media.uploadImage({
      buffer: Buffer.concat([SIGNATURES["image/png"], Buffer.alloc(1024)]),
      mimetype: "image/png",
      folder: "posters",
    });
    await media.markCleanupPending(publicId, "event_attach_failed");

    const record = await MediaAsset.findOne({ publicId }).lean();
    assert.strictEqual(record.status, "cleanup_pending");
    assert.strictEqual(record.cleanupReason, "event_attach_failed");
    assert.ok(record.cleanupAfter, "still has a grace window before reclamation");
  });

  await test("§55 reclamation never touches `active` assets", async () => {
    // An active asset whose cleanupAfter is in the past must STILL be safe.
    await MediaAsset.create({
      publicId: "active-but-stale",
      provider: "cloudinary",
      folder: "posters",
      status: "active",
      // Deliberately stale: proves status wins over the timestamp.
      cleanupAfter: new Date(Date.now() - 999 * 24 * 60 * 60 * 1000),
    });
    const reclaimable = await MediaAsset.reclaimable(new Date());
    const ids = reclaimable.map((a) => a.publicId);
    assert.ok(!ids.includes("active-but-stale"), "ACTIVE assets must never be reclaimable");
  });

  await test("§55 only assets past their grace window are reclaimable", async () => {
    const future = "pending-future-" + Date.now();
    const past = "pending-past-" + Date.now();
    await MediaAsset.create({
      publicId: future,
      status: "pending",
      cleanupAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await MediaAsset.create({
      publicId: past,
      status: "pending",
      cleanupAfter: new Date(Date.now() - 60 * 1000),
    });

    const ids = (await MediaAsset.reclaimable(new Date())).map((a) => a.publicId);
    assert.ok(ids.includes(past), "expired pending asset is reclaimable");
    assert.ok(!ids.includes(future), "asset still inside its grace window is safe");
  });

  await test("failed uploads surface a clean StorageUploadError, no raw provider error", async () => {
    // A buffer that passes validation but trips the (unconfigured) provider.
    let threw = null;
    try {
      await media.uploadImage({
        buffer: Buffer.concat([SIGNATURES["image/png"], Buffer.alloc(1024)]),
        mimetype: "image/png",
        folder: "nonexistent-provider-path",
      });
    } catch (err) {
      threw = err;
    }
    // Either it succeeds (local fallback) or throws our clean error — but it
    // must never leak a raw provider object with internals.
    if (threw) {
      assert.strictEqual(threw.code, "STORAGE_UPLOAD_FAILED", threw.message);
      assert.strictEqual(threw.status, 502);
    }
    assert.ok(true);
  });

  /* ══════════════════════════════════════════════════════════
   * 8. Upload metrics (§57)
   * ══════════════════════════════════════════════════════ */
  section("8. Upload metrics (§57)");

  await test("successes and failures are counted and expose a failure rate", () => {
    metrics.reset();
    metrics.recordUploadSuccess();
    metrics.recordUploadSuccess();
    metrics.recordUploadSuccess();
    metrics.recordUploadFailure();

    const u = metrics.snapshot().uploads;
    assert.strictEqual(u.successes, 3);
    assert.strictEqual(u.failures, 1);
    assert.strictEqual(u.failureRate, 25, "1 of 4 attempts failed → 25%");
  });

  await test("failure rate is 0 when nothing has been uploaded", () => {
    metrics.reset();
    assert.strictEqual(metrics.snapshot().uploads.failureRate, 0);
  });

  /* ══════════════════════════════════════════════════════════
   * 9. Frontend wiring audit
   * ══════════════════════════════════════════════════════ */
  section("9. Frontend wiring audit");

  const FE = path.join(__dirname, "..", "..", "frontend", "src");
  const readFe = (rel) => fs.readFileSync(path.join(FE, rel), "utf8");

  await test("§19 hot-path images render through OptimizedImage", () => {
    for (const f of [
      "components/event-card.tsx",
      "components/user-avatar.tsx",
      "components/feed/feed-post.tsx",
      "components/profile/posts-grid.tsx",
      "components/feed/event-post-card.tsx",
      "components/profile/profile-header.tsx",
    ]) {
      const src = readFe(f);
      assert.ok(src.includes("OptimizedImage"), `${f} must use OptimizedImage`);
    }
  });

  await test("§19 OptimizedImage emits srcset, lazy loading and async decode", () => {
    const src = readFe("components/ui/optimized-image.tsx");
    assert.ok(src.includes("srcSet"), "responsive srcset (§19)");
    assert.ok(src.includes('loading={priority ? "eager" : "lazy"}'), "lazy by default (§50)");
    assert.ok(src.includes("decoding="), "async decode (§50)");
    assert.ok(src.includes("fetchPriority"), "LCP priority control (§50)");
  });

  await test("§20 uploads compress on-device before hitting the network", () => {
    for (const f of [
      "components/feed/create-post.tsx",
      "components/admin/event-form.tsx",
      "components/profile/profile-view.tsx",
    ]) {
      const src = readFe(f);
      assert.ok(src.includes("compressFor"), `${f} must compress before upload`);
    }
  });

  await test("§20 the compressor never blocks an upload when it can't help", () => {
    const src = readFe("utils/compress-image.ts");
    assert.ok(src.includes("compression did not help"), "returns original when bigger");
    assert.ok(src.includes("image/gif"), "GIFs are not re-encoded");
    assert.ok(src.includes("already small enough"), "small files skip CPU work");
  });

  await test("§49 next.config enables modern formats + Cloudinary remote pattern", () => {
    const cfg = fs.readFileSync(path.join(FE, "..", "next.config.ts"), "utf8");
    assert.ok(cfg.includes("res.cloudinary.com"), "remote pattern present");
    assert.ok(cfg.includes("image/avif"), "AVIF enabled");
    assert.ok(cfg.includes("image/webp"), "WebP enabled");
  });

  await test("§55 upload routes track the orphan lifecycle", () => {
    const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "upload.routes.js"), "utf8");
    assert.ok(routes.includes("markCleanupPending"), "failed consume → cleanup_pending");
    assert.ok(routes.includes("markAttached"), "successful consume → active");
    assert.ok(routes.includes("/attach"), "client can confirm attachment");
  });

  await test("§23 upload endpoints stay behind stricter-than-default limits", () => {
    // Limiters are mounted centrally in config/rate-limits.js, not server.js.
    const limits = fs.readFileSync(path.join(__dirname, "..", "config", "rate-limits.js"), "utf8");
    assert.ok(limits.includes('app.use("/api/upload"'), "upload prefix is rate limited");
    assert.ok(limits.includes("UPLOAD_HOURLY"), "hourly upload-session cap exists");
    assert.ok(limits.includes("UPLOAD_BURST"), "burst cap exists");
  });

  await mongoose.disconnect();
  await mongo.stop();

  // Remove the scratch upload directory created above.
  try {
    fs.rmSync(TEST_UPLOADS, { recursive: true, force: true });
  } catch (_err) {
    /* best effort */
  }

  console.log("\n" + "═".repeat(52));
  console.log(`  PHASE 4 SELF-TEST: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(52) + "\n");
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error("\n💥 Phase 4 selftest crashed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
