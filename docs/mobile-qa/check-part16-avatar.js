/**
 * check-part16-avatar.js — Part 16 · C · the identity pipeline, end to end.
 *
 *   QA_EMAIL=ana<stamp>@qa.com node check-part16-avatar.js
 *
 * Drives the REAL flow — pick a file, crop it, confirm, save — then checks the
 * two things that used to be wrong:
 *
 *   §37–§40  ONE canonical asset: pick → crop → canonical render → upload →
 *            store. Every surface shows the same asset, square, centred, with
 *            no per-component re-framing, and it appears without a reload.
 *   §41–§43  the banner gets its own crop, and the focal point it produces
 *            survives a reload (a reposition that resets is not a reposition).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const zlib = require("zlib");

/* QA_READY accepts either the JSON itself (the older harnesses' convention)
   or a path to it, so every script in this folder takes the same variable. */
const _raw = process.env.QA_READY;
const QA = _raw && _raw.trim().startsWith("{")
  ? JSON.parse(_raw)
  : JSON.parse(fs.readFileSync(_raw || "/var/tmp/qa-ready.json", "utf8"));
const API = process.env.QA_API || "http://127.0.0.1:5999/api";
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;

let pass = 0;
const fails = [];
const ok = (cond, label) => (cond ? pass++ : fails.push(label));
const log = (...a) => console.log("   ", ...a);

/* ── real PNG bytes: the upload route validates shape, so fixtures must be
      genuine images, not placeholders ─────────────────────────────────── */
function crc32(buf) {
  let c,
    crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const FIX = "/var/tmp/pw";
fs.mkdirSync(FIX, { recursive: true });
fs.writeFileSync(`${FIX}/avatar-square.png`, png(512, 512, (x, y) => [(x * 255) / 512 | 0, (y * 255) / 512 | 0, 200]));
/* taller than 3:1 on purpose: a 3:1 source cannot move vertically, so the
   banner focal-point assertion would be vacuous */
fs.writeFileSync(`${FIX}/cover-tall.png`, png(1200, 800, (x, y) => [30, (x * 255) / 1200 | 0, (y * 255) / 800 | 0]));

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async (em) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "Test1234!" }),
    });
    const j = await r.json();
    localStorage.setItem("token", j.token);
    localStorage.setItem("user", JSON.stringify(j.user));
  }, EMAIL);
}

/** every avatar-ish image on screen, with the box it was drawn in */
const avatars = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (r.width < 16 || r.width > 240) continue;
      if (Math.abs(r.width - r.height) > 2) continue;
      const cs = getComputedStyle(img);
      out.push({
        src: img.currentSrc || img.src,
        path: (img.currentSrc || img.src).split("?")[0],
        fit: cs.objectFit,
        pos: cs.objectPosition,
        alt: img.alt,
      });
    }
    return out;
  });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const uploads = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/upload/") || u.includes("/auth/me/profile")) uploads.push(`${r.request().method()} ${u.split("/api/")[1]} → ${r.status()}`);
  });
  page.on("console", (m) => m.type() === "error" && log("console:", m.text().slice(0, 140)));

  await signIn(page);
  await page.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  log("opening the editor…");
  await page.getByRole("button", { name: /Edit profile/i }).first().click();
  await page.waitForTimeout(1200);
  const sheet = page.locator('[role="dialog"][aria-label="Edit profile"]');
  await sheet.waitFor({ timeout: 10000 });

  /* ── the avatar ─────────────────────────────────────────────────────── */
  const fileInputs = sheet.locator('input[type="file"]');
  const n = await fileInputs.count();
  ok(n >= 2, `the sheet offers both uploaders (${n} file inputs)`);
  await fileInputs.first().setInputFiles(`${FIX}/avatar-square.png`);
  await page.waitForTimeout(1500);

  const crop = page.locator('[role="dialog"][aria-label="Profile photo"]');
  await crop.waitFor({ timeout: 10000 });
  ok(await crop.isVisible(), "picking a photo opens the crop editor (nothing is uploaded before the user confirms)");
  const cropBox = await crop.boundingBox();
  ok(cropBox && cropBox.width <= 392, `the crop editor fits the phone width (${Math.round(cropBox?.width || 0)}px)`);

  /* the classic mobile trap: manipulating the canvas must not scroll the page */
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cropBox.x + cropBox.width / 2 + 40, cropBox.y + cropBox.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterScroll = await page.evaluate(() => window.scrollY);
  ok(beforeScroll === afterScroll, `dragging the crop does not scroll the page (${beforeScroll} → ${afterScroll})`);

  await crop.getByRole("button", { name: /Use photo/i }).click();
  await page.waitForTimeout(4000);
  log("uploads so far:", uploads.join(" | ") || "none");
  ok(uploads.some((u) => /POST .*upload\/image/.test(u) && u.includes("200")), "the cropped file is uploaded as a canonical render (POST /upload/image 200)");
  ok(uploads.some((u) => /PUT .*auth\/me\/profile/.test(u) && u.includes("200")), "the new asset + its crop are persisted (PUT /auth/me/profile 200)");

  /* ── the cover ──────────────────────────────────────────────────────── */
  uploads.length = 0;
  /* input 0 = avatar gallery, 1 = avatar camera, 2 = cover gallery */
  await fileInputs.nth(2).setInputFiles(`${FIX}/cover-tall.png`);
  await page.waitForTimeout(1500);
  const crop2 = page.locator('[role="dialog"][aria-label="Cover photo"]');
  await crop2.waitFor({ timeout: 10000 });
  const box2 = await crop2.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2 - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await crop2.getByRole("button", { name: /Use cover/i }).click();
  await page.waitForTimeout(4000);
  log("cover uploads:", uploads.join(" | ") || "none");
  ok(uploads.some((u) => /POST .*folder=posters&purpose=cover/.test(u)), "the banner is cropped to its canonical 3:1 and uploaded (folder=posters&purpose=cover)");
  ok(uploads.some((u) => /PUT .*auth\/me\/profile/.test(u) && u.includes("200")), "the banner write is persisted as well");

  const saveBtn = sheet.getByRole("button", { name: /^Save/i }).first();
  if (await saveBtn.isEnabled().catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(3500);
  }
  const text = await page.evaluate(() => document.body.innerText);
  ok(!/Couldn.t save/i.test(text), "the save reported success, not an error");

  /* ── the stored shape ───────────────────────────────────────────────── */
  const api = await (await fetch(`${API}/users/${QA.ana.id}/profile`, { headers: { Authorization: `Bearer ${QA.ana.token}` } })).json();
  const p = api.user.profile;
  ok(Boolean(p.avatar), `the profile stores one avatar asset (${String(p.avatar).split("/").pop()})`);
  ok(p.avatarVersion > 0, `the asset carries a version so a replaced photo is never served from cache (v=${p.avatarVersion})`);
  ok(Boolean(p.avatarCrop), "the chosen crop is stored with the asset (re-crop is possible)");
  ok(Boolean(p.coverImage), `the banner asset is stored (${String(p.coverImage).split("/").pop()})`);
  ok(typeof p.coverPosition === "number" && p.coverPosition !== 50, `the banner focal point was persisted, not reset (${p.coverPosition})`);

  const avatarName = String(p.avatar).split("?")[0].split("/").pop();
  const coverName = String(p.coverImage).split("?")[0].split("/").pop();

  /* ── every identity surface, without a reload ───────────────────────── */
  await page.waitForTimeout(1200);
  const onProfile = await avatars(page);
  const mine = onProfile.filter((a) => a.path.includes(avatarName));
  ok(mine.length >= 1, `the profile header shows the new photo without a page reload (${mine.length} instance(s))`);
  ok(mine.every((a) => a.fit === "cover"), `…drawn with object-fit: cover (${[...new Set(mine.map((a) => a.fit))].join(",")})`);
  ok(mine.every((a) => a.pos === "50% 50%" || a.pos === "50% 50% 0px"), `…centred, with no per-component framing (${[...new Set(mine.map((a) => a.pos))].join(" | ")})`);
  const weird = onProfile.filter((a) => !a.path.includes(avatarName) && a.alt && !/event|cover|banner/i.test(a.alt));
  ok(weird.length === 0, `…and nothing is still drawing an older/other avatar asset (${weird.map((w) => `${w.alt}:${w.path.split("/").pop()}`).slice(0, 3).join(", ") || "clean"})`);

  /* client-side navigation: the shell must reuse the updated identity, not a
     cached response */
  await page.getByRole("link", { name: /^Home$/i }).first().click().catch(async () => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  });
  await page.waitForTimeout(3500);
  const onFeed = await avatars(page);
  ok(onFeed.filter((a) => a.path.includes(avatarName)).length >= 1, "the feed's top bar shows the same asset after client-side navigation");

  /* back to the profile: the banner is drawn from the stored asset, at the
     stored focal point, and the avatar survives the reload */
  await page.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const banner = await page.evaluate((needle) => {
    const hits = [...document.querySelectorAll("img,div")].filter((e) => {
      const s = e.tagName === "IMG" ? e.currentSrc || e.src : getComputedStyle(e).backgroundImage;
      return s && s.includes(needle);
    });
    return hits.map((e) => ({
      tag: e.tagName,
      fit: e.tagName === "IMG" ? getComputedStyle(e).objectFit : "background",
      pos: e.tagName === "IMG" ? getComputedStyle(e).objectPosition : getComputedStyle(e).backgroundPosition,
    }));
  }, coverName);
  log("banner render:", JSON.stringify(banner).slice(0, 220));
  ok(banner.length >= 1, `the stored banner renders on the profile (${banner.length} element(s))`);
  ok(banner.every((b) => !b.pos || b.pos.includes(String(p.coverPosition))), `the banner is drawn at the stored focal point (${p.coverPosition}%) — ${banner.map((b) => b.pos).join(" | ")}`);

  const reloaded = await avatars(page);
  ok(reloaded.some((a) => a.path.includes(avatarName)), `the photo survives a reload (${reloaded.filter((a) => a.path.includes(avatarName)).length} instance(s))`);
  ok(reloaded.every((a) => a.fit === "cover" && (a.pos === "50% 50%" || a.pos === "50% 50% 0px")), "every reloaded avatar is still a centred square crop");

  await page.screenshot({ path: `${FIX}/p16-avatar-profile.png` }).catch(() => {});
  await ctx.close();
  await browser.close();

  console.log(`\nPART 16 AVATAR ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS CRASHED", e);
  process.exit(2);
});
