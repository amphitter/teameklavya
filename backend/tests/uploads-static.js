/**
 * What we write is what we serve.
 *
 *   node tests/uploads-static.js
 *
 * The storage provider writes uploads into UPLOADS_DIR; the express static
 * mount serves `/uploads`. Those two were derived independently — the provider
 * honoured UPLOADS_DIR, the mount was hardcoded to `backend/uploads` — so any
 * environment that set the variable (QA runs, ephemeral hosts, a mounted
 * volume) accepted an upload, stored it, returned its URL, and then 404'd it.
 * The API said 200 and the user got a broken image.
 *
 * This test points UPLOADS_DIR somewhere of its own and proves a file that
 * travels through the provider's public API comes back byte-identical over
 * HTTP at the URL the API reports.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5113";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "uploads-static-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";

const path = require("path");
const fs = require("fs");
const http = require("http");

/* A directory that is neither the repo default nor shared with any other run. */
const UPLOADS_DIR = path.join("/var/tmp", `uploads-static-${Date.now()}`);
process.env.UPLOADS_DIR = UPLOADS_DIR;

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

function get(urlPath, host, port) {
  return new Promise((resolve) => {
    const req = http.request({ host, port, path: urlPath, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
    });
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.end();
  });
}

/** Smallest valid PNG (1x1), so the sniffer sees real image bytes. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dataDir = path.join("/var/tmp", `mongo-uploads-${Date.now()}`);
  fs.mkdirSync(dataDir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dataDir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");

  const { uploadsDir } = require("../services/storage.provider");
  const storage = require("../services/storage.provider");
  require("../server");

  for (let i = 0; i < 60; i++) {
    try {
      const r = await get("/api/health", "127.0.0.1", process.env.PORT);
      if (r.status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log("\n── the served directory is the written directory ──");
  ok(
    path.resolve(uploadsDir) === path.resolve(UPLOADS_DIR),
    "the static mount uses the storage provider's resolved directory",
    `${uploadsDir} vs ${UPLOADS_DIR}`
  );

  /* Write through the provider — the exact call media.service makes on the
     upload route, so this test covers the real path and not a lookalike. */
  const result = await storage.provider.upload({
    buffer: PNG_1PX,
    mimetype: "image/png",
    folder: "posts",
    publicId: `uploads-static-check-${Date.now()}`,
  });
  const url = typeof result === "string" ? result : result?.url || result?.secure_url;
  ok(Boolean(url), "the provider returns a URL for the stored file", JSON.stringify(result)?.slice(0, 160));
  ok(String(url).startsWith("/uploads/"), "…and it is a /uploads URL", String(url));

  const onDisk = path.join(UPLOADS_DIR, String(url).replace(/^\/uploads\//, ""));
  ok(fs.existsSync(onDisk), "the bytes landed inside UPLOADS_DIR", onDisk);

  const served = await get(String(url), "127.0.0.1", process.env.PORT);
  ok(served.status === 200, "GET on that URL returns 200 (not 404)", `status ${served.status}`);
  ok(/image\/png/.test(String(served.type)), "…with an image content type", String(served.type));
  ok(served.body?.equals?.(PNG_1PX), "…and the exact bytes that were uploaded", `${served.body?.length} bytes back`);

  /* The legacy location must keep working for files written before this fix. */
  const legacyDir = path.join(__dirname, "..", "uploads", "posts");
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyFile = path.join(legacyDir, "uploads-static-legacy.png");
  fs.writeFileSync(legacyFile, PNG_1PX);
  const legacyServed = await get("/uploads/posts/uploads-static-legacy.png", "127.0.0.1", process.env.PORT);
  ok(legacyServed.status === 200, "a file in the repository's legacy uploads dir is still served", `status ${legacyServed.status}`);
  fs.rmSync(legacyFile, { force: true });

  const missing = await get("/uploads/posts/definitely-not-here.png", "127.0.0.1", process.env.PORT);
  ok(missing.status === 404, "an absent upload is a 404, not a crash", `status ${missing.status}`);

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  const mongoose = require("mongoose");
  await mongoose.disconnect().catch(() => {});
  await mongod.stop().catch(() => {});
  fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
