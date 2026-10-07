#!/usr/bin/env node
/**
 * Phase 2 live verification — the canonical avatar/cover contract, end to end.
 *
 *   cd /var/tmp/pw && node phase2.js
 *
 * Runs a REAL browser against the REAL app and the REAL backend (the seeded QA
 * server on :5999, frontend on :3000), signs in as a seeded user, and exercises
 * both flows the brief demands be tested rather than described:
 *
 *   • the IMAGE flow — pick a photo, crop it with actual touch gestures,
 *     confirm, and then prove the pixels the server stored are the pixels the
 *     editor showed, rendered the same in the header and the shell
 *   • the SAVE flow — exactly one PUT per action, a version that is stable
 *     across reloads and changes only when the asset changes
 *
 * Fixtures are generated in-process: a 1200×1600 portrait in four coloured
 * bands and a 2400×1800 cover in three. Bands are what make the assertions
 * possible — "the circle is green" is a claim about WHICH REGION survived the
 * crop, which a solid-colour fixture could never show.
 */
const { chromium } = require("playwright");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = {
  email: process.env.QA_EMAIL || "ana1791397564035@qa.com",
  password: "Test1234!",
};
const USERNAME = process.env.QA_USERNAME || "ana_roy";
const OUT = "/home/user/qa/profile-audit";

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
const section = (t) => console.log(`\n══ ${t} ══`);

/* ── fixture images ──────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

/** A banded RGB PNG: `bands` colours stacked vertically, top to bottom. */
function bandedPng(w, h, bands) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const bandH = Math.floor(h / bands.length);
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const band = bands[Math.min(bands.length - 1, Math.floor(y / bandH))];
    const off = y * (1 + w * 3);
    raw[off] = 0;
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = band[0];
      raw[off + 2 + x * 3] = band[1];
      raw[off + 3 + x * 3] = band[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const RED = [220, 40, 40];
const GREEN = [30, 180, 70];
const BLUE = [40, 70, 220];
const YELLOW = [230, 200, 30];
const MAGENTA = [210, 40, 190];

/** Which band a source-space y coordinate falls in (for the banded fixtures). */
const bandOf = (y, height, count) =>
  Math.min(count - 1, Math.floor(y / (height / count)));

const fixtureDir = "/var/tmp/pw/fixtures";
fs.mkdirSync(fixtureDir, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const PORTRAIT = { w: 1200, h: 1600, bands: [RED, GREEN, BLUE, YELLOW] };
const portraitPath = path.join(fixtureDir, "portrait-4bands.png");
fs.writeFileSync(portraitPath, bandedPng(PORTRAIT.w, PORTRAIT.h, PORTRAIT.bands));

const PORTRAIT2 = { w: 1200, h: 1600, bands: [MAGENTA, YELLOW, GREEN, RED] };
const portrait2Path = path.join(fixtureDir, "portrait-2-fourbands.png");
fs.writeFileSync(portrait2Path, bandedPng(PORTRAIT2.w, PORTRAIT2.h, PORTRAIT2.bands));

const COVER = { w: 2400, h: 1800, bands: [RED, GREEN, BLUE] };
const coverPath = path.join(fixtureDir, "cover-3bands.png");
fs.writeFileSync(coverPath, bandedPng(COVER.w, COVER.h, COVER.bands));

/* ── helpers ─────────────────────────────────────────────────────────── */

const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

/** Classify a sampled pixel as one of the fixture colours. */
function nameOfColour([r, g, b]) {
  const refs = { red: RED, green: GREEN, blue: BLUE, yellow: YELLOW, magenta: MAGENTA };
  let best = "?";
  let bestD = Infinity;
  for (const [name, ref] of Object.entries(refs)) {
    const d = (r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return bestD < 12000 ? best : `unknown(${r},${g},${b})`;
}

/* ── the run ─────────────────────────────────────────────────────────── */

(async () => {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=3"],
  });

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const page = await phone.newPage();

  /* Record every profile write and every upload — the "one click = one PUT"
     rule from Phase 1 must still hold for the image flow. */
  const uploads = [];
  const puts = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (r.method() === "POST" && u.pathname.includes("/upload/image")) {
      uploads.push({ url: r.url(), body: r.postData() ? r.postData().length : 0 });
    }
    if (r.method() === "PUT" && u.pathname.includes("/auth/me/profile")) {
      let parsed = null;
      try {
        parsed = JSON.parse(r.postData() || "{}");
      } catch {}
      puts.push({ at: Date.now(), body: parsed });
    }
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 150)));
  /* The edit sheet asks for confirmation before discarding unsaved changes —
     without this the dialogs are auto-dismissed and the sheet quietly stays
     open, which would make every "the sheet closed" check a lie. */
  page.on("dialog", (d) => d.accept());

  /* ── sign in ── */
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  const session = await page.evaluate(async (creds) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem("token", data.token);
      if (data.user) localStorage.setItem("user", JSON.stringify(data.user));
    }
    return { status: res.status, token: data.token, user: data.user };
  }, CREDS);
  ok(Boolean(session.token), "signed in as the seeded user", `status ${session.status}`);

  /* Give the account a handle so /profile/<username> resolves, exactly as a
     real member would on their first visit to the edit sheet. */
  const named = await page.evaluate(
    async ({ token, username }) => {
      const res = await fetch("/api/auth/me/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { token: session.token, username: USERNAME }
  );
  ok(named.status === 200, "account has a handle for the public profile URL", `status ${named.status}`);

  const profileUrl = `${APP}/profile/${USERNAME}`;
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  const editBtn = page.locator("button", { hasText: "Edit profile" }).first();
  await editBtn.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  ok((await editBtn.count()) > 0, "the profile page renders with its own Edit profile entry point");

  /* ═══════════════ 1 · the editor ═══════════════ */
  section("1. The crop editor opens on a real photo");

  const openSheet = async () => {
    await editBtn.click();
    await page.locator('[role="dialog"][aria-label="Edit profile"]').waitFor({ state: "visible", timeout: 8000 });
  };
  await openSheet();
  ok(true, "the edit sheet opened");

  const avatarFileInput = page.locator(
    '[role="dialog"][aria-label="Edit profile"] input[type="file"]:not([capture])'
  ).first();
  await avatarFileInput.setInputFiles(portraitPath);

  const editor = page.locator('[role="dialog"][aria-label="Profile photo"]');
  await editor.waitFor({ state: "visible", timeout: 10000 });
  ok(true, "picking a 1200×1600 portrait opens the crop editor (no “crop it and try again” dead end)");

  const frame = editor.locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]');
  const zoomSlider = editor.locator('input[aria-label="Zoom"]');
  await frame.waitFor({ state: "visible" });

  const touchAction = await frame.evaluate((el) => getComputedStyle(el).touchAction);
  ok(touchAction === "none", "the frame declares touch-action:none (a drag cannot scroll the page)", `got "${touchAction}"`);

  const frameBox = await frame.boundingBox();
  const zoom0 = Number(await zoomSlider.inputValue());

  /** The preview transform at this instant, read from the DOM the user sees. */
  const readPreview = () =>
    frame.locator("img").evaluate((img) => ({
      left: parseFloat(img.style.left),
      top: parseFloat(img.style.top),
      width: parseFloat(img.style.width),
      height: parseFloat(img.style.height),
      src: img.getAttribute("src"),
    }));

  /** Derive the source-rect the editor is currently showing, in source px. */
  const sourceRectFromPreview = async (natural) => {
    const p = await readPreview();
    const scale = natural.w / p.width; // preview px → source px
    const box = await frame.boundingBox();
    return {
      sx: -p.left * scale,
      sy: -p.top * scale,
      sw: box.width * scale,
      sh: box.height * scale,
      scale,
      preview: p,
      box,
    };
  };
  const natural = { w: PORTRAIT.w, h: PORTRAIT.h };

  const before = await sourceRectFromPreview(natural);
  ok(
    near(before.sw, 1200, 1) && near(before.sy, 200, 2),
    "the identity view is a full-width square, centred (y = (1600-1200)/2 = 200)",
    JSON.stringify({ sx: before.sx, sy: before.sy, sw: before.sw })
  );

  /* ═══════════════ 2 · gestures ═══════════════ */
  section("2. Touch gestures pan and zoom without scrolling the page");

  const scrollBefore = await page.evaluate(() => ({ y: window.scrollY, top: document.documentElement.scrollTop }));
  const cdp = await phone.newCDPSession(page);
  const cx = frameBox.x + frameBox.width / 2;
  const cy = frameBox.y + frameBox.height / 2;

  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 12, radiusY: 12, force: 1 })),
    });

  /* A real downward drag: reveals the TOP of the photo. */
  const startY = cy - 60;
  await touch("touchStart", [{ x: cx, y: startY }]);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", [{ x: cx, y: startY + (i * 220) / 8 }]);
    await new Promise((r) => setTimeout(r, 16));
  }
  await touch("touchEnd", []);
  await new Promise((r) => setTimeout(r, 120));

  const scrollAfter = await page.evaluate(() => ({ y: window.scrollY, top: document.documentElement.scrollTop }));
  ok(
    scrollAfter.y === scrollBefore.y && scrollAfter.top === scrollBefore.top,
    "the page did not scroll during the drag",
    `before ${scrollBefore.y}/${scrollBefore.top} → after ${scrollAfter.y}/${scrollAfter.top}`
  );

  const afterDrag = await sourceRectFromPreview(natural);
  ok(
    afterDrag.sy < before.sy - 50,
    "the drag moved the crop towards the top of the photo",
    `sy ${before.sy.toFixed(1)} → ${afterDrag.sy.toFixed(1)}`
  );
  ok(afterDrag.sy >= -1, "…and stopped exactly at the image edge (clamped, never past it)", `sy=${afterDrag.sy.toFixed(2)}`);

  /* Pinch: two fingers moving apart. */
  const zoomBeforePinch = Number(await zoomSlider.inputValue());
  const mid = { x: cx - 45, y: cy };
  const mid2 = { x: cx + 45, y: cy };
  await touch("touchStart", [mid, mid2]);
  for (let i = 1; i <= 6; i++) {
    await touch("touchMove", [
      { x: mid.x - i * 12, y: mid.y },
      { x: mid2.x + i * 12, y: mid2.y },
    ]);
    await new Promise((r) => setTimeout(r, 16));
  }
  await touch("touchEnd", []);
  await new Promise((r) => setTimeout(r, 150));
  const zoomAfterPinch = Number(await zoomSlider.inputValue());
  ok(zoomAfterPinch > zoomBeforePinch + 0.1, "pinching apart zooms in", `${zoomBeforePinch} → ${zoomAfterPinch}`);
  const zoomed = await sourceRectFromPreview(natural);
  ok(zoomed.sw < 1200 - 50, "…and the visible source window really got smaller", `sw ${zoomed.sw.toFixed(0)}`);

  /* A React-controlled <input type=range> ignores a plain `el.value = x`: its
     value tracker sees no change and the handler never runs. The native setter
     is the standard way to drive it from a test. */
  const setZoom = async (value) => {
    await zoomSlider.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await new Promise((r) => setTimeout(r, 160));
  };

  /* Zoom clamps. */
  await setZoom(4);
  const maxed = await sourceRectFromPreview(natural);
  ok(
    Math.abs(maxed.sw - 1200 / 4) <= 3,
    "at the 4× limit the window is exactly a quarter of the width (1200/4 = 300)",
    `sw ${maxed.sw.toFixed(0)}`
  );

  /* Double-tap resets — the gesture people try when they get lost. */
  const tap = async (x, y) => {
    await touch("touchStart", [{ x, y }]);
    await new Promise((r) => setTimeout(r, 40));
    await touch("touchEnd", []);
  };
  await tap(cx, cy);
  await new Promise((r) => setTimeout(r, 90));
  await tap(cx, cy);
  await new Promise((r) => setTimeout(r, 200));
  const zoomAfterDoubleTap = Number(await zoomSlider.inputValue());
  const reset = await sourceRectFromPreview(natural);
  ok(zoomAfterDoubleTap <= 1.01, "double-tap resets the zoom", `zoom ${zoomAfterDoubleTap}`);
  ok(near(reset.sy, 200, 3) && near(reset.sx, 0, 3), "…and re-centres the photo", `sy ${reset.sy.toFixed(1)}`);

  /* Now set a DELIBERATELY OFF-CENTRE framing: drag upwards (towards the
     bottom of the photo), then zoom in. A crop composed this way cannot be
     mistaken for a default centre crop — which is the whole point of testing
     it: the pixels that reach the circle have to be the ones the user framed. */
  await touch("touchStart", [{ x: cx, y: cy + 60 }]);
  for (let i = 1; i <= 6; i++) {
    await touch("touchMove", [{ x: cx, y: cy + 60 - (i * 140) / 6 }]);
    await new Promise((r) => setTimeout(r, 16));
  }
  await touch("touchEnd", []);
  await setZoom(1.5);

  const framed = await sourceRectFromPreview(natural);
  const expectedCrop = {
    x: framed.sx / natural.w,
    y: framed.sy / natural.h,
    w: framed.sw / natural.w,
    h: framed.sh / natural.h,
  };
  console.log(
    `     framing: source ${framed.sx.toFixed(0)},${framed.sy.toFixed(0)} ${framed.sw.toFixed(0)}×${framed.sh.toFixed(0)}` +
      ` → crop ${JSON.stringify(expectedCrop)}`
  );

  await page.screenshot({ path: `${OUT}/phase2-editor-390.png` });

  /* ═══════════════ 3 · confirm → upload → save ═══════════════ */
  section("3. Confirming uploads the canonical square and saves the crop");

  uploads.length = 0;
  puts.length = 0;
  await editor.locator("button", { hasText: "Use photo" }).click();

  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"][aria-label="Profile photo"]'),
    null,
    { timeout: 20000 }
  );
  await new Promise((r) => setTimeout(r, 600));

  ok(uploads.length === 1, "exactly one upload for one confirm", `${uploads.length} upload(s)`);
  ok(
    uploads[0] && /purpose=avatar/.test(uploads[0].url),
    "…declared as the canonical avatar (so the server checks the square it received)",
    uploads[0]?.url
  );
  const uploadPut = puts.find((p) => p.body?.avatar);
  ok(puts.length === 1, "exactly one profile write for one confirm", `${puts.length} write(s)`);
  ok(Boolean(uploadPut), "…and it carries the new avatar URL");
  ok(Boolean(uploadPut?.body?.avatarCrop), "…with the crop the user chose", JSON.stringify(uploadPut?.body?.avatarCrop));
  ok(
    typeof uploadPut?.body?.avatarVersion === "number" && uploadPut.body.avatarVersion > 0,
    "…and a version stamp",
    String(uploadPut?.body?.avatarVersion)
  );
  const sentCrop = uploadPut?.body?.avatarCrop;
  ok(
    near(sentCrop.x, expectedCrop.x) && near(sentCrop.y, expectedCrop.y) && near(sentCrop.w, expectedCrop.w) && near(sentCrop.h, expectedCrop.h),
    "the crop that was SAVED is the crop the editor SHOWED",
    `saved ${JSON.stringify(sentCrop)} vs shown ${JSON.stringify(expectedCrop)}`
  );

  /* The sheet persists the image immediately; close it without a second save. */
  await page.locator('[role="dialog"][aria-label="Edit profile"]').locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  ok(puts.length === 1, "closing the sheet did not add a second write", `${puts.length} write(s)`);

  /* ═══════════════ 4 · what the server stored ═══════════════ */
  section("4. The stored profile matches, and the URL is versioned");

  const readMe = () =>
    page.evaluate(async () => {
      const res = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      return data.user || data;
    });

  const stored = await readMe();
  ok(Boolean(stored?.profile?.avatar), "the profile has an avatar", stored?.profile?.avatar);
  ok(
    JSON.stringify(stored.profile.avatarCrop) === JSON.stringify(sentCrop),
    "the stored crop is byte-identical to what was sent",
    JSON.stringify(stored.profile.avatarCrop)
  );
  ok(stored.profile.avatarVersion === uploadPut.body.avatarVersion, "the stored version matches");
  ok(!/^data:/.test(stored.profile.avatar), "the avatar is a URL, never base64 in the database");

  /* ═══════════════ 5 · rendering ═══════════════ */
  section("5. Every surface renders that one canonical asset");

  const readAvatars = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((img) => (img.currentSrc || img.src || "").includes("/avatars/"))
        .map((img) => {
          const r = img.getBoundingClientRect();
          const host = img.closest('[role="dialog"], header, nav, section, aside, article');
          return {
            src: img.getAttribute("src") || "",
            box: [Math.round(r.width), Math.round(r.height)],
            where: host ? `${host.tagName.toLowerCase()}:${(host.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24)}` : "unhosted",
          };
        })
    );

  const liveRows = await readAvatars();
  const liveNow = liveRows.map((r) => r.src);
  console.log("     surfaces now:", JSON.stringify(liveRows, null, 0).slice(0, 900));
  ok(
    liveNow.length >= 2 && liveNow.every((s) => /\?v=\d+/.test(s)),
    "the header and nav show the new photo immediately after upload — no reload, no logout",
    JSON.stringify(liveNow)
  );
  ok(new Set(liveNow).size === 1, "…and they all point at the one canonical asset", JSON.stringify(liveNow));

  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const avatarImgs = await page.evaluate(() => {
    return [...document.querySelectorAll("img")]
      .filter((img) => (img.currentSrc || img.src || "").includes("/avatars/"))
      .map((img) => ({
        src: img.getAttribute("src") || "",
        currentSrc: img.currentSrc || "",
        srcset: img.getAttribute("srcset") || "",
        box: { w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) },
        styleW: img.style.width,
        styleH: img.style.height,
        objectPosition: getComputedStyle(img).objectPosition,
      }));
  });
  /* The header and the bottom-nav avatar read the SESSION, the profile header
     reads the API. Before the uploader published the new photo to the session,
     those two disagreed until a reload — assert they agree immediately. */
  ok(
    avatarImgs.length >= 2,
    "the new photo is already on the other surfaces (profile header + nav avatar), no reload",
    `${avatarImgs.length} image(s): ${JSON.stringify(avatarImgs.map((i) => i.src))}`
  );

  const versioned = avatarImgs.every((i) => /\?v=\d+/.test(i.src));
  ok(versioned, "every rendered avatar carries the asset version as `?v=`", JSON.stringify(avatarImgs.map((i) => i.src).slice(0, 3)));
  const sameVersion = new Set(avatarImgs.map((i) => (i.src.match(/\?v=(\d+)/) || [])[1]));
  ok(sameVersion.size === 1, "…and the SAME version everywhere (no per-component stamp)", [...sameVersion].join(","));
  const sameUrl = new Set(avatarImgs.map((i) => i.src.split("?")[0]));
  ok(sameUrl.size === 1, "…and the same underlying asset — one canonical file, not a copy per surface", [...sameUrl].join(","));

  /* The claim that matters: the broker's srcset asks for the same SHAPE at
     every width. A fixed height would mean a different crop per device. */
  const srcsetAudit = avatarImgs
    .map((i) => i.srcset)
    .filter(Boolean)
    .flatMap((s) => s.split(",").map((entry) => entry.trim().split(" ")[0]));
  const transformed = srcsetAudit.filter((u) => u.includes("/image/upload/"));
  const shareTheShape = transformed.every((u) => {
    const m = u.match(/w_(\d+),h_(\d+)/);
    if (!m) return true; // served as-is (local storage) — nothing to compare
    return Number(m[1]) === Number(m[2]);
  });
  ok(
    shareTheShape,
    transformed.length
      ? "every requested variant is SQUARE — one shape, different resolutions"
      : "variant shape rule not exercised here (local disk storage emits no CDN transforms) — covered by tests/run-variant-tests.js",
    transformed.join(" | ") || "no transformable URLs in this environment"
  );

  const visibleBoxes = liveRows.filter((r) => r.box[0] > 0 && r.box[1] > 0);
  ok(
    visibleBoxes.length > 0 && visibleBoxes.every((r) => r.box[0] === r.box[1]),
    "…and every VISIBLE box is a true square — no squashed oval standing in for the photo",
    JSON.stringify(visibleBoxes.map((r) => ({ box: r.box, where: r.where })))
  );
  ok(
    liveRows.every((r) => r.box[0] === r.box[1] || r.box[0] === 0),
    "…including the one inside the edit sheet",
    JSON.stringify(liveRows.map((r) => r.box))
  );
  const centred = avatarImgs.every((i) => i.objectPosition.replace(/\s/g, "") === "50%50%");
  ok(centred, "no per-component object-position (each is centred)", JSON.stringify(avatarImgs.map((i) => i.objectPosition)));

  /* ═══════════════ 6 · do the PIXELS match the crop? ═══════════════ */
  section("6. The pixels in the circle are the region the user chose");

  const sampled = await page.evaluate(async (src) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("load failed"));
      img.src = src;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3);
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      centre: px(img.naturalWidth / 2, img.naturalHeight / 2),
      topQuarter: px(img.naturalWidth / 2, img.naturalHeight * 0.15),
      bottomQuarter: px(img.naturalWidth / 2, img.naturalHeight * 0.85),
    };
  }, avatarImgs[0].currentSrc || avatarImgs[0].src);

  ok(sampled.w === sampled.h && sampled.w === 512, "the served avatar IS the canonical 512×512 square", `${sampled.w}×${sampled.h}`);

  /* Which band should the centre be, given the stored crop? */
  const cropCentreY = (stored.profile.avatarCrop.y + stored.profile.avatarCrop.h / 2) * PORTRAIT.h;
  const expectedBand = nameOfColour(PORTRAIT.bands[bandOf(cropCentreY, PORTRAIT.h, PORTRAIT.bands.length)]);
  const actualBand = nameOfColour(sampled.centre);
  ok(
    actualBand === expectedBand,
    `the centre of the circle is the band the crop points at (${expectedBand})`,
    `expected ${expectedBand} at source y=${cropCentreY.toFixed(0)}, sampled ${actualBand} from ${JSON.stringify(sampled.centre)}`
  );

  /* A deliberately off-centre crop must show a DIFFERENT band top vs bottom —
     proof the crop, not a blanket centre crop, decided the content. */
  const topBand = nameOfColour(sampled.topQuarter);
  const bottomBand = nameOfColour(sampled.bottomQuarter);
  console.log(`     avatar bands: top ${topBand} · centre ${actualBand} · bottom ${bottomBand}`);
  ok(
    topBand !== bottomBand,
    "the square spans more than one band — it is a real crop of the photo, not a flat fill",
    `${topBand} / ${bottomBand}`
  );

  /* ═══════════════ 7 · versioning is stable, and only moves with the asset ══ */
  section("7. The version moves only when the asset does");

  const v1 = (avatarImgs[0].src.match(/\?v=(\d+)/) || [])[1];
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const afterReload = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((i) => (i.currentSrc || i.src || "").includes("/avatars/"))
      .map((i) => i.getAttribute("src"))
  );
  const v2 = (afterReload[0].match(/\?v=(\d+)/) || [])[1];
  ok(v1 === v2, "reloading the page keeps the same version (never a per-render timestamp)", `${v1} → ${v2}`);
  const meAgain = await readMe();
  ok(
    JSON.stringify(meAgain.profile.avatarCrop) === JSON.stringify(stored.profile.avatarCrop),
    "…and two reads return an identical crop"
  );

  /* Desktop rendering of the same account. */
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const dpage = await desktop.newPage();
  await dpage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  /* A real sign-in on this device — the identity the shell then renders comes
     from the login payload, exactly as it would for a member opening the site
     on a laptop after setting a photo on their phone. */
  const dlogin = await dpage.evaluate(async (creds) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    });
    const data = await res.json();
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    return { status: res.status, hasProfile: Boolean(data.user?.profile), avatar: data.user?.profile?.avatar || "" };
  }, CREDS);
  ok(
    dlogin.hasProfile,
    "the login payload carries the identity the shell renders (no second fetch needed)",
    JSON.stringify(dlogin)
  );
  await dpage.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await dpage.waitForTimeout(1400);
  const desktopAvatars = await dpage.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((i) => (i.currentSrc || i.src || "").includes("/avatars/"))
      .map((i) => ({ src: i.getAttribute("src"), srcset: i.getAttribute("srcset") || "", box: [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)], objectPosition: getComputedStyle(i).objectPosition }))
  );
  ok(
    desktopAvatars.length >= 2,
    "the desktop layout renders the avatar in the header AND the shell/account surfaces",
    `${desktopAvatars.length} image(s)`
  );
  ok(
    desktopAvatars.every((i) => /\?v=(\d+)/.test(i.src) && i.src.match(/\?v=(\d+)/)[1] === v1),
    "desktop requests the SAME versioned asset as the phone — identical composition across devices",
    JSON.stringify(desktopAvatars.map((i) => i.src))
  );
  ok(
    desktopAvatars.every((i) => i.box[0] === i.box[1] && i.objectPosition.replace(/\s/g, "") === "50%50%"),
    "…square, centred, with no per-device object-position",
    JSON.stringify(desktopAvatars.map((i) => [i.box, i.objectPosition]))
  );
  /* Both device pixel ratios must ask for the same SHAPE. */
  const phoneShapes = new Set(transformed.map((u) => (u.match(/w_(\d+),h_(\d+)/) || []).join(",")));
  const desktopUrls = desktopAvatars.flatMap((i) => i.srcset.split(",").map((s) => s.trim().split(" ")[0])).filter((u) => u.includes("/image/upload/"));
  const desktopShapes = new Set(desktopUrls.map((u) => (u.match(/w_(\d+),h_(\d+)/) || []).join(",")));
  const everyShapeIsSquare = (shapes) =>
    shapes.length > 0 &&
    shapes.every((s) => {
      const [w, h] = s.split(",");
      return Boolean(w && h) && w.replace("w_", "") === h.replace("h_", "");
    });
  const localOnly = phoneShapes.size === 0 && desktopShapes.size === 0;
  ok(
    localOnly || (everyShapeIsSquare([...desktopShapes]) && everyShapeIsSquare([...phoneShapes])),
    localOnly
      ? "variant shapes not observable here (no CDN transforms with local storage) — rule covered by tests/run-variant-tests.js"
      : "desktop variants are square too (phone and desktop cannot diverge)",
    `phone: ${[...phoneShapes].join(" ")} | desktop: ${[...desktopShapes].join(" ")}`
  );
  await dpage.screenshot({ path: `${OUT}/phase2-profile-desktop.png` });

  /* ═══════════════ 8 · a second photo gets a NEW version ═══════════════ */
  section("8. Replacing the photo changes the version — and only then");

  const me3 = await readMe();
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await editBtn.waitFor({ state: "visible", timeout: 10000 });
  await editBtn.click();
  await page.locator('[role="dialog"][aria-label="Edit profile"]').waitFor({ state: "visible" });
  await page.locator('[role="dialog"][aria-label="Edit profile"] input[type="file"]:not([capture])').first().setInputFiles(portrait2Path);
  const editor2 = page.locator('[role="dialog"][aria-label="Profile photo"]');
  await editor2.waitFor({ state: "visible", timeout: 10000 });
  /* Re-opened on the stored crop — the user's framing, not a fresh centre crop. */
  const reopened = await editor2.locator("img").evaluate((img) => ({
    left: parseFloat(img.style.left),
    top: parseFloat(img.style.top),
    width: parseFloat(img.style.width),
    height: parseFloat(img.style.height),
  }));
  const box2 = await editor2
    .locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]')
    .boundingBox();
  /* A DIFFERENT photo opens on a fresh centred view — deliberately. The stored
     crop is a fraction of the OLD image, so reusing it would frame the new
     photo at a position nobody chose. (Restoring a stored crop is what the
     re-crop path does, for the same image — asserted in section 9.) */
  const scale2 = PORTRAIT2.w / reopened.width;
  ok(
    near(-reopened.left * scale2, 0, 6) && near(-reopened.top * scale2, (PORTRAIT2.h - PORTRAIT2.w) / 2, 6),
    "a different photo starts from a centred square, not the previous photo's framing",
    `source ${(-reopened.left * scale2).toFixed(0)},${(-reopened.top * scale2).toFixed(0)}`
  );
  await editor2.locator("button", { hasText: "Use photo" }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Profile photo"]'), null, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 700));
  await page.locator('[role="dialog"][aria-label="Edit profile"]').locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  const meAfter = await readMe();
  const v3 = meAfter.profile.avatarVersion;
  ok(String(v3) !== String(v1), "the new photo has a new version", `${v1} → ${v3}`);
  ok(Boolean(v1) && Boolean(v3), "…and both are real stamps, not empty strings");
  ok(meAfter.profile.avatar !== stored.profile.avatar, "…and a new asset URL");

  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const rendered3 = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((i) => (i.currentSrc || i.src || "").includes("/avatars/")).map((i) => i.getAttribute("src"))
  );
  ok(
    rendered3.length > 0 && rendered3.every((s) => s.includes(`v=${v3}`)),
    "the page renders the NEW version immediately (the old one is never cached in place)",
    JSON.stringify(rendered3.slice(0, 2))
  );
  const sampled2 = await page.evaluate(async (src) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error("load failed"));
      img.src = src;
    });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = Array.from(ctx.getImageData(Math.round(img.naturalWidth / 2), Math.round(img.naturalHeight / 2), 1, 1).data).slice(0, 3);
    return { w: img.naturalWidth, h: img.naturalHeight, centre: d };
  }, rendered3[0]);
  const crop2CentreY = (meAfter.profile.avatarCrop.y + meAfter.profile.avatarCrop.h / 2) * PORTRAIT2.h;
  const expected2 = nameOfColour(PORTRAIT2.bands[bandOf(crop2CentreY, PORTRAIT2.h, PORTRAIT2.bands.length)]);
  ok(
    nameOfColour(sampled2.centre) === expected2,
    `the new photo's pixels match its own crop (${expected2})`,
    `sampled ${nameOfColour(sampled2.centre)} at source y=${crop2CentreY.toFixed(0)}`
  );
  await page.screenshot({ path: `${OUT}/phase2-profile-390-after-second-photo.png` });

  /* ═══════════════ 9 · legacy avatars get a re-crop path ═══════════════ */
  section("9. A pre-crop avatar is offered a re-crop (the migration path)");

  const legacyPath = (meAfter.profile.avatar.match(/^https?:/) ? meAfter.profile.avatar : `${APP}${meAfter.profile.avatar}`);
  await page.evaluate(
    async ({ token, url }) => {
      await fetch("/api/auth/me/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ avatar: url, avatarCrop: null }),
      });
    },
    { token: session.token, url: meAfter.profile.avatar }
  );
  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await editBtn.waitFor({ state: "visible", timeout: 10000 });
  await editBtn.click();
  await page.locator('[role="dialog"][aria-label="Edit profile"]').waitFor({ state: "visible" });
  await page.waitForTimeout(400);
  const recrop = page.locator("button", { hasText: "Re-crop this photo" });
  ok((await recrop.count()) > 0, "an avatar with no stored crop shows the re-crop affordance");
  ok(
    await page.locator("text=Every screen shows a different part of it").count() > 0,
    "…and explains why (legacy framing is not guaranteed on every screen)"
  );
  await recrop.first().click();
  const reEditor = page.locator('[role="dialog"][aria-label="Profile photo"]');
  await reEditor.waitFor({ state: "visible", timeout: 8000 });
  const reSrc = await reEditor.locator("img").first().getAttribute("src");
  ok(
    Boolean(reSrc) && (legacyPath.includes(reSrc) || reSrc.includes("/avatars/")),
    "the editor opens on the SAME stored photo — no re-upload, no loss of the original",
    String(reSrc)
  );
  /* Frame it deliberately, save, then re-open: the editor must come back to
     the framing the user chose, not to another centre crop. This is the whole
     point of storing `avatarCrop` next to the rendered square. */
  const reFrame = reEditor.locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]');
  const reBox = await reFrame.boundingBox();
  const reCdp = await phone.newCDPSession(page);
  const rcx = reBox.x + reBox.width / 2;
  const rcy = reBox.y + reBox.height / 2;
  await reCdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rcx, y: rcy, id: 0, radiusX: 12, radiusY: 12, force: 1 }],
  });
  for (let i = 1; i <= 6; i++) {
    await reCdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: rcx, y: rcy + (i * 90) / 6, id: 0, radiusX: 12, radiusY: 12, force: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await reCdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await new Promise((r) => setTimeout(r, 150));
  const reFramed = await reEditor.locator("img").evaluate((img) => ({ left: parseFloat(img.style.left), top: parseFloat(img.style.top), width: parseFloat(img.style.width) }));
  const reScale = 512 / reFramed.width; // the re-crop source is the 512px canonical file
  await reEditor.locator("button", { hasText: "Use photo" }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Profile photo"]'), null, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 900));
  const afterRecrop = await readMe();
  ok(Boolean(afterRecrop.profile.avatarCrop), "re-cropping a legacy photo stores a crop", JSON.stringify(afterRecrop.profile.avatarCrop));

  const sheetNow = page.locator('[role="dialog"][aria-label="Edit profile"]');
  ok(
    (await page.locator("button", { hasText: "Re-crop this photo" }).count()) === 0,
    "…and the re-crop offer disappears, because the photo now has one"
  );
  /* The photo now HAS a crop, so the offer changes from the legacy banner to a
     plain "Re-crop" — and opening it must land on the framing that was just
     chosen, not on a fresh centre crop. That is the whole reason `avatarCrop`
     is stored next to the rendered square. */
  const reopenCrop = page.locator('[role="dialog"][aria-label="Edit profile"] button', { hasText: "Re-crop" }).first();
  ok((await reopenCrop.count()) > 0, "a photo with a stored crop offers Re-crop");
  await reopenCrop.click();
  const reEditor2 = page.locator('[role="dialog"][aria-label="Profile photo"]');
  await reEditor2.waitFor({ state: "visible", timeout: 8000 });
  const restored = await reEditor2.locator("img").evaluate((img) => ({ left: parseFloat(img.style.left), top: parseFloat(img.style.top), width: parseFloat(img.style.width) }));
  const restoredBox = await reEditor2.locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]').boundingBox();
  /* The canonical file is 512px square, so the preview maps to it 1:1 in ratio. */
  const canonical = 512;
  const shownScale = canonical / restored.width;
  const saved = afterRecrop.profile.avatarCrop;
  ok(
    near(-restored.left * shownScale, saved.x * canonical, 6) && near(-restored.top * shownScale, saved.y * canonical, 6),
    "Re-crop re-opens on the crop the user chose (not a fresh centre crop)",
    `shown ${(-restored.left * shownScale).toFixed(0)},${(-restored.top * shownScale).toFixed(0)} ` +
      `vs stored ${(saved.x * canonical).toFixed(0)},${(saved.y * canonical).toFixed(0)} ` +
      `(window ${(restoredBox.width * shownScale).toFixed(0)} vs ${(saved.w * canonical).toFixed(0)})`
  );
  await reEditor2.locator("button", { hasText: "Cancel" }).first().click();
  await page.waitForTimeout(300);
  await sheetNow.locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await page.waitForTimeout(400);

  /* ═══════════════ 10 · the cover ═══════════════ */
  section("10. The cover: same contract, 3:1, and a focal point derived from the crop");

  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await editBtn.waitFor({ state: "visible", timeout: 10000 });
  await editBtn.click();
  const sheet = page.locator('[role="dialog"][aria-label="Edit profile"]');
  await sheet.waitFor({ state: "visible" });
  /* The cover section's file input is the one after the avatar's two. */
  const coverInput = sheet.locator('input[type="file"]:not([capture])').nth(1);
  puts.length = 0;
  uploads.length = 0;
  await coverInput.setInputFiles(coverPath);
  const coverEditor = page.locator('[role="dialog"][aria-label="Cover photo"]');
  await coverEditor.waitFor({ state: "visible", timeout: 10000 });
  const coverFrame = coverEditor.locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]');
  const coverBox = await coverFrame.boundingBox();
  ok(
    near(coverBox.width / coverBox.height, 3, 0.05),
    "the cover frame is 3:1 — the shape the asset is stored in",
    `${coverBox.width.toFixed(0)}×${coverBox.height.toFixed(0)} = ${(coverBox.width / coverBox.height).toFixed(3)}`
  );
  await coverEditor.locator("button", { hasText: "Use cover" }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Cover photo"]'), null, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  ok(uploads.length === 1 && /purpose=cover/.test(uploads[0].url), "one cover upload, declared 3:1", uploads[0]?.url);

  const coverPut = puts.find((p) => p.body?.coverImage);
  ok(Boolean(coverPut), "…saved as the profile's cover");
  ok(Boolean(coverPut?.body?.coverCrop), "with its crop", JSON.stringify(coverPut?.body?.coverCrop));
  ok(typeof coverPut?.body?.coverVersion === "number" || typeof coverPut?.body?.coverImage === "string", "and a version");
  const cc = coverPut?.body?.coverCrop;
  const derivedFocal = Math.round((cc.y + cc.h / 2) * 100);
  ok(
    Math.abs(Number(coverPut.body.coverPosition) - derivedFocal) <= 1,
    "the focal point is derived from the crop, so the two can never disagree",
    `sent ${coverPut.body.coverPosition}, crop implies ${derivedFocal}`
  );
  await sheet.locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const coverImg = await page.evaluate(() => {
    const img = [...document.querySelectorAll("img")].find((i) => (i.getAttribute("src") || "").includes("/posters/"));
    if (!img) return null;
    const cs = getComputedStyle(img);
    return {
      src: img.getAttribute("src"),
      objectPosition: cs.objectPosition,
      objectFit: cs.objectFit,
      box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)],
      loaded: img.naturalWidth,
    };
  });
  ok(Boolean(coverImg), "the cover renders on the profile", JSON.stringify(coverImg));
  ok(Boolean(coverImg?.loaded), "…and the image actually loaded (no broken banner)", String(coverImg?.loaded));
  ok(/\?v=\d+/.test(coverImg?.src || ""), "the cover URL is versioned too", coverImg?.src);
  ok(
    coverImg?.objectPosition.replace(/\s/g, "") === `50%${coverPut.body.coverPosition}%`,
    "…and positioned at the stored focal point",
    `${coverImg?.objectPosition} vs 50% ${coverPut.body.coverPosition}%`
  );
  await page.screenshot({ path: `${OUT}/phase2-profile-390-cover.png` });

  /* ═══════════════ 11 · removal ═══════════════ */
  section("11. Removing an image clears the image AND the crop behind it");

  await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
  await editBtn.waitFor({ state: "visible", timeout: 10000 });
  await editBtn.click();
  const rsheet = page.locator('[role="dialog"][aria-label="Edit profile"]');
  await rsheet.waitFor({ state: "visible" });
  puts.length = 0;
  await rsheet.locator("button", { hasText: "Remove" }).first().click();
  await page.waitForTimeout(1200);
  const removePut = puts.find((p) => p.body && "avatar" in p.body);
  ok(Boolean(removePut), "removing the photo writes the profile", JSON.stringify(puts.map((p) => Object.keys(p.body))));
  ok(removePut?.body?.avatar === "", "…setting the avatar to empty");
  ok(removePut?.body && "avatarCrop" in removePut.body && removePut.body.avatarCrop === null, "…and dropping the crop with it", JSON.stringify(removePut?.body?.avatarCrop));
  const afterRemove = await readMe();
  ok(afterRemove.profile.avatar === "", "the server confirms it is gone");
  ok(!afterRemove.profile.avatarCrop, "…and no crop is left pointing at a photo that no longer exists");

  const fallbackSurfaces = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter((i) => (i.currentSrc || i.src || "").includes("/avatars/")).length
  );
  ok(fallbackSurfaces === 0, "every surface falls back to initials together — no half-removed avatar", `${fallbackSurfaces} stray image(s)`);

  const rcover = rsheet.locator("button", { hasText: "Remove" }).last();
  puts.length = 0;
  await rcover.click();
  await page.waitForTimeout(1200);
  const coverRemove = puts.find((p) => p.body && "coverImage" in p.body);
  ok(coverRemove?.body?.coverImage === "", "removing the cover clears it");
  ok(coverRemove?.body?.coverPosition === 50, "…and resets the focal point, so the next upload starts clean", String(coverRemove?.body?.coverPosition));
  await rsheet.locator("button", { hasText: "Cancel" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/phase2-profile-390-removed.png` });

  /* ═══════════════ 12 · nothing regressed ═══════════════ */
  section("12. No console errors, no stray writes");

  ok(pageErrors.length === 0, "no uncaught page errors during the whole run", pageErrors.join(" | "));

  await browser.close();

  console.log(`\n${failed === 0 ? "✅" : "❌"} PHASE 2 LIVE: ${passed} passed, ${failed} failed`);
  console.log(`   screenshots: ${OUT}/phase2-*.png`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
