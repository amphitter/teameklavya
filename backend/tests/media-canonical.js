/**
 * Phase 2 — the canonical image contract, server side.
 *
 *   node tests/media-canonical.js
 *
 * The crop editor decides the framing; that decision is only worth anything if
 * the server actually stores what it claims to. Two halves are asserted here:
 *
 *   1. `POST /api/upload/image?purpose=avatar|cover` — when the caller declares
 *      a canonical shape, the bytes must BE that shape. A square avatar and a
 *      3:1 cover are accepted; anything else is a 400 with a message that names
 *      the problem. Uploads that declare nothing keep the behaviour they always
 *      had, so no existing client breaks (asserted, not assumed).
 *
 *   2. `PUT /api/auth/me/profile` — the crop and the asset version round-trip.
 *      A bad crop is rejected rather than stored (a crop outside 0–1 would
 *      re-open the editor on a region that does not exist), and a legacy
 *      avatar without a crop must NOT be given an invented one: "no crop" is
 *      the signal the UI uses to offer a re-crop, so it has to stay truthful.
 *
 * Every image below is a real PNG built byte by byte — real magic bytes and a
 * real IHDR — because the whole point of the server-side checks is that they
 * read the BYTES, never the declared type. Generating them also keeps the test
 * free of binary fixtures.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5109";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = process.env.JWT_SECRET || "canonical-test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";
// Never write fixture images into the repository.
process.env.UPLOADS_DIR = `/var/tmp/canonical-uploads-${Date.now()}`;

const http = require("http");
const zlib = require("zlib");

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
const section = (t) => console.log(`\n── ${t} ──`);

const PORT = process.env.PORT;

/* ── PNGs built from scratch ─────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** A real, valid RGB PNG of exactly `w`×`h`, filled with a flat colour. */
function png(w, h, rgb = [80, 120, 200]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // rows: one filter byte + 3 bytes per pixel, all identical → compresses tiny
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Just the header — enough for `readDimensions` (used for the size ceilings). */
function pngHeaderOnly(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── HTTP ────────────────────────────────────────────────────────────── */

function requestRaw(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve) => {
    const h = { accept: "application/json", ...headers };
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: h }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ s: res.statusCode, d: JSON.parse(d) });
        } catch {
          resolve({ s: res.statusCode, d: d.slice(0, 200) });
        }
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

function call(method, path, body, token) {
  const payload = body ? JSON.stringify(body) : null;
  const headers = payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {};
  if (token) headers.authorization = `Bearer ${token}`;
  return requestRaw(method, path, { body: payload, headers });
}

/** multipart/form-data by hand — one file part, no dependencies. */
let boundaryCounter = 0;
function upload(path, buffer, { filename = "a.png", mime = "image/png", token } = {}) {
  const boundary = `----ehcanonical${++boundaryCounter}${Date.now()}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, buffer, tail]);
  return requestRaw("POST", path, {
    body,
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": body.length,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const fs = require("fs");
  const dataDir = `/var/tmp/mongo-canonical-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dataDir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  for (let i = 0; i < 60; i++) {
    try {
      if ((await call("GET", "/api/health")).s === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }

  const mongoose = require("mongoose");
  const User = require("../models/user.model");
  await User.init();

  const stamp = Date.now();
  const me = { email: `canon${stamp}@x.com`, password: "Test1234!" };
  await call("POST", "/api/auth/signup", {
    ...me,
    firstName: "Ana",
    lastName: "Roy",
    confirmPassword: me.password,
    acceptTerms: true,
  });
  await User.updateMany({ email: me.email }, { $set: { emailVerified: true } });
  const login = await call("POST", "/api/auth/login", me);
  const token = login.d?.token;
  ok(Boolean(token), "logged in", `status ${login.s}`);
  await call("PUT", "/api/auth/me/profile", { username: `canon_${String(stamp).slice(-6)}` }, token);

  /* ─────────────────────────────────────────────────────────────────── */

  section("the canonical avatar: a square is accepted");
  const square = png(512, 512);
  const upSquare = await upload("/api/upload/image?folder=avatars&purpose=avatar", square, { token });
  ok(upSquare.s === 200, "512×512 → 200", `status ${upSquare.s}: ${JSON.stringify(upSquare.d).slice(0, 160)}`);
  ok(typeof upSquare.d?.url === "string" && upSquare.d.url.length > 0, "the response carries a URL");
  ok(
    upSquare.d?.variants && ["thumb", "small", "medium", "large"].every((k) => k in upSquare.d.variants),
    "…and the responsive variants the avatar renders",
    JSON.stringify(upSquare.d?.variants)
  );

  section("a non-square is refused when the caller declares it canonical");
  const wide = png(512, 400);
  const upWide = await upload("/api/upload/image?folder=avatars&purpose=avatar", wide, { token });
  ok(upWide.s === 400, "512×400 → 400, not a silent non-canonical store", `status ${upWide.s}: ${JSON.stringify(upWide.d).slice(0, 160)}`);
  ok(
    /square/i.test(String(upWide.d?.message)) && String(upWide.d?.message).includes("512×400"),
    "the message names the real problem and the real size",
    String(upWide.d?.message)
  );
  ok(!upWide.d?.url, "and nothing was stored for it");

  section("…but an upload that declares nothing keeps the old behaviour");
  const legacy = await upload("/api/upload/image?folder=avatars", wide, { token });
  ok(legacy.s === 200, "no purpose → 200, exactly as before this change", `status ${legacy.s}`);

  section("too small to be canonical");
  const tiny = await upload("/api/upload/image?folder=avatars&purpose=avatar", png(64, 64), { token });
  ok(tiny.s === 400, "64×64 → 400", `status ${tiny.s}`);
  ok(/at least 128/i.test(String(tiny.d?.message)), "the message states the minimum", String(tiny.d?.message));

  section("the canonical cover: 3:1 accepted, other shapes refused");
  const cover = png(1600, 533); // what the editor renders — 3.0019:1, not exactly 3:1
  const upCover = await upload("/api/upload/image?folder=posters&purpose=cover", cover, { token });
  ok(upCover.s === 200, "1600×533 → 200 (the editor's own output passes the check)", `status ${upCover.s}: ${JSON.stringify(upCover.d).slice(0, 160)}`);
  const fourThree = await upload("/api/upload/image?folder=posters&purpose=cover", png(1600, 900), { token });
  ok(fourThree.s === 400, "1600×900 → 400", `status ${fourThree.s}`);
  ok(/3:1/.test(String(fourThree.d?.message)), "the message explains the frame", String(fourThree.d?.message));

  section("the size ceilings still apply to declared uploads");
  const media = require("../services/media.service");
  ok(
    typeof media.validateShape(pngHeaderOnly(5000, 5000), "avatar") === "string",
    "a 5000×5000 avatar is refused (the canonical render is 512)"
  );
  ok(media.validateShape(png(512, 512), "avatar") === null, "and 512×512 passes");
  ok(media.validateShape(png(1600, 533), "cover") === null, "1600×533 passes as a cover");
  ok(media.validateShape(png(512, 400), null) === null, "no declaration means no shape rule");

  section("a spoofed type is still caught on the bytes");
  const spoof = await upload("/api/upload/image?folder=avatars&purpose=avatar", square, {
    filename: "photo.jpg",
    mime: "image/jpeg",
    token,
  });
  ok(spoof.s === 400, "PNG bytes declared as image/jpeg → 400", `status ${spoof.s}`);
  ok(
    /don't match|dont match/i.test(String(spoof.d?.message)),
    "and it fails on content, not on the declared type",
    String(spoof.d?.message)
  );

  /* ─────────────────────── profile round-trip ───────────────────────── */

  const url = upSquare.d.url;
  section("the crop + version round-trip through the profile");
  const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
  const saved = await call(
    "PUT",
    "/api/auth/me/profile",
    { avatar: url, avatarCrop: crop, avatarVersion: 1700000000000 },
    token
  );
  ok(saved.s === 200, "PUT with crop + version → 200", `status ${saved.s}: ${JSON.stringify(saved.d).slice(0, 160)}`);
  ok(saved.d?.user?.profile?.avatarCrop?.x === 0.125, "the save response carries the crop back");
  ok(saved.d?.user?.profile?.avatarVersion === 1700000000000, "…and the version");

  const fetched = await call("GET", "/api/auth/me", null, token);
  const fresh = fetched.d?.user?.profile;
  ok(fresh?.avatar === url, "a fresh GET returns the stored avatar");
  ok(JSON.stringify(fresh?.avatarCrop) === JSON.stringify(crop), "…the same crop, to the digit", JSON.stringify(fresh?.avatarCrop));
  ok(fresh?.avatarVersion === 1700000000000, "…and the same version (so `?v=` is stable across requests)");

  section("a crop that would put the editor outside the image is rejected");
  const overflow = await call("PUT", "/api/auth/me/profile", { avatarCrop: { x: 0.5, y: 0, w: 0.8, h: 1 } }, token);
  ok(overflow.s === 400, "x+w > 1 → 400", `status ${overflow.s}`);
  const empty = await call("PUT", "/api/auth/me/profile", { avatarCrop: { x: 0, y: 0, w: 0, h: 1 } }, token);
  ok(empty.s === 400, "a zero-width crop → 400", `status ${empty.s}`);
  const nan = await call("PUT", "/api/auth/me/profile", { avatarCrop: { x: "left", y: 0, w: 1, h: 1 } }, token);
  ok(nan.s === 400, "a non-numeric fraction → 400", `status ${nan.s}`);
  const badVersion = await call("PUT", "/api/auth/me/profile", { avatarVersion: -5 }, token);
  ok(badVersion.s === 400, "a negative version → 400", `status ${badVersion.s}`);

  const afterBad = await call("GET", "/api/auth/me", null, token);
  ok(
    JSON.stringify(afterBad.d?.user?.profile?.avatarCrop) === JSON.stringify(crop),
    "and none of those rejections damaged the crop that was already stored"
  );

  section("a legacy avatar is NOT given an invented crop");
  const legacyUrl = upSquare.d.url;
  const legacySave = await call("PUT", "/api/auth/me/profile", { avatar: legacyUrl, avatarCrop: null, avatarVersion: 1700000001000 }, token);
  ok(legacySave.s === 200, "clearing the crop is allowed", `status ${legacySave.s}`);
  const legacyGet = await call("GET", "/api/auth/me", null, token);
  ok(legacyGet.d?.user?.profile?.avatarCrop === null, "the profile reports no crop (which is what triggers the re-crop offer)");

  section("removing the photo removes its crop");
  const removed = await call("PUT", "/api/auth/me/profile", { avatar: "" }, token);
  ok(removed.s === 200 && removed.d?.user?.profile?.avatar === "", "avatar cleared");
  ok(removed.d?.user?.profile?.avatarCrop === null, "…and the crop with it, so the next upload starts clean");

  section("cover crop + version behave the same way");
  const coverCrop = { x: 0, y: 0.1, w: 1, h: 0.6 };
  const coverSave = await call(
    "PUT",
    "/api/auth/me/profile",
    { coverImage: upCover.d.url, coverCrop, coverVersion: 1700000002000, coverPosition: 25 },
    token
  );
  ok(coverSave.s === 200, "PUT cover + crop + focal point → 200", `status ${coverSave.s}`);
  const coverGet = await call("GET", "/api/auth/me", null, token);
  ok(JSON.stringify(coverGet.d?.user?.profile?.coverCrop) === JSON.stringify(coverCrop), "the cover crop round-trips");
  ok(coverGet.d?.user?.profile?.coverPosition === 25, "…and the focal point is persisted next to it");
  const coverRemoved = await call("PUT", "/api/auth/me/profile", { coverImage: "" }, token);
  ok(coverRemoved.s === 200 && coverRemoved.d?.user?.profile?.coverPosition === 50, "removing the banner resets the focal point to 50");
  ok(coverRemoved.d?.user?.profile?.coverCrop === null, "…and drops the crop");

  console.log(`\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
  await mongoose.disconnect().catch(() => {});
  await mongod.stop().catch(() => {});
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
