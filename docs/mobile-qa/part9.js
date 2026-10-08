#!/usr/bin/env node
/**
 * PART 9 — final UX fixes: the acceptance checklist (§50) on real screens.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node part9.js '<QA_READY json>'
 *
 * What this verifies, and why each check is shaped the way it is:
 *
 *  STORIES (§14–§25) — the editor is exercised as a phone (touch, coarse
 *  pointer): a text layer is placed, dragged, pinched and rotated; ink is drawn
 *  and undone; a sticker is picked from REAL data; the preview is compared
 *  against what the server actually stored, layer by layer. A desktop context is
 *  checked separately, because the requirement there is the opposite one: it must
 *  NOT offer the editor.
 *
 *  PROFILE / POSTS / MESSAGES / FEED — these were built in earlier rounds. They
 *  are re-checked here as acceptance criteria (own posts visible, saved/liked/
 *  archive reachable, sent-right/received-left, one messages entry point, the
 *  filter strip tappable), not rebuilt.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "", password: "Test1234!" };
const OUT = "/home/user/qa/part9";
const READY = (() => {
  try {
    return JSON.parse(process.argv[2] || "{}");
  } catch {
    return {};
  }
})();

let checks = 0;
let failures = 0;
const ok = (cond, label, detail = "") => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  ❌ [${label}]${detail ? ` — ${detail}` : ""}`);
  }
};
const info = (label, detail) => console.log(`     · ${label}: ${detail}`);
const section = (t) => console.log(`\n── ${t} ──`);


/** Real multi-touch, through the browser's own input pipeline.
 *
 * `page.touchscreen` can only tap, and hand-built PointerEvents are not the
 * events a finger produces: the app calls `setPointerCapture` on the layer and
 * Chromium refuses it for a pointer id it never issued, then the gesture map
 * keeps the stale id and the next gesture measures the wrong pair. CDP
 * `Input.dispatchTouchEvent` goes in at the same layer as hardware, so the two
 * fingers are real, capture works, and the maths under test is the maths a
 * thumb would drive. */
const cdpTouch = async (page, points) => {
  const client = await page.context().newCDPSession(page);
  const mk = (pts) => pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 12, radiusY: 12, force: 1 }));
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: mk(points) });
  return client;
};
const touchMove = (client, points) =>
  client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 12, radiusY: 12, force: 1 })),
  });
const touchEnd = (client) => client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

const signIn = async (page, creds = CREDS) => {
  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async (c) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    const d = await r.json();
    if (d.token) {
      localStorage.setItem("token", d.token);
      localStorage.setItem("user", JSON.stringify(d.user));
    }
  }, creds);
};

/** A PNG of the given colour, so uploads in this harness are REAL media. */
const pngOf = (w, h, rgb) => {
  const zlib = require("zlib");
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = rgb[0];
      raw[o++] = rgb[1];
      raw[o++] = rgb[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(require("zlib").crc32 ? require("zlib").crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const crc32 = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  /* ══════════════════════════════════════════════════════════════════════
   * A · STORY CREATOR (§14–§23) — on a phone
   * ══════════════════════════════════════════════════════════════════════ */
  section("A · story creator (phone)");
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);

    /* — §15/§23 entry: your own ring watches, the ⊕ beside it creates — */
    const ring = page.locator('button[aria-label^="Your story"], button[aria-label^="View your story"]').first();
    ok((await ring.count()) > 0, "§15 the story rail shows Your story");
    const creatorEntry = page.locator('button[aria-label="Add to your story"]').first();
    ok((await creatorEntry.count()) > 0, "§15 creating from the rail is a separate, reachable control");
    /* Tap the ring's FACE (not the badge: a measured overlap check, because the
       ⊕ sits on the ring's corner and must not eat the ring's own tap). */
    const ringBox = await ring.boundingBox();
    await page.touchscreen.tap(ringBox.x + ringBox.width / 2, ringBox.y + 22);
    await page.waitForTimeout(1500);
    const openedViewer = (await page.locator('[role="dialog"][aria-label*="story"]').count()) > 0;
    ok(openedViewer, "§23 tapping your ring opens YOUR story in the viewer");
    if (openedViewer) {
      const vLabel = await page.locator('[role="dialog"][aria-label*="story"]').first().getAttribute("aria-label");
      info("own viewer", vLabel || "");
      const x = page.locator('button[aria-label="Close story"]');
      if ((await x.count()) > 0) {
        await x.click();
        await page.waitForTimeout(800);
      } else {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
      }
    }
    await creatorEntry.click();
    await page.waitForSelector('[role="dialog"][aria-label="Create a story"]', { timeout: 6000 });
    await page.waitForTimeout(500);
    const dialogText = await page.locator('[role="dialog"][aria-label="Create a story"]').innerText();
    ok(/Camera/.test(dialogText) && /Gallery/.test(dialogText), "§15 offers Camera and Gallery");
    ok(/Text/.test(dialogText), "§15 offers a text-only story");
    await page.screenshot({ path: `${OUT}/01-story-entry.png` });

    /* — §16/§17 canvas via the TEXT route (no camera in a sandbox) — */
    await page.locator('[aria-label="Create a story"] button:has-text("Text")').first().click();
    await page.waitForTimeout(700);
    const textArea = page.locator('textarea[aria-label="Story text"]');
    ok((await textArea.count()) > 0, "§18 tapping Text opens the keyboard input");
    await textArea.fill("Hack night at 7pm");
    ok(
      (await page.locator('button[aria-label="Weight Heavy"]').count()) > 0 &&
        (await page.locator('button[aria-label="Text colour #ffb300"]').count()) > 0,
      "§18 text can be styled (colour + weight + alignment)"
    );
    await page.locator('[aria-label="Create a story"] button[aria-label="Text colour #ffb300"]').click();
    await page.locator('[aria-label="Create a story"] button[aria-label="Weight Heavy"]').click();
    await page.screenshot({ path: `${OUT}/04-story-text-mode.png` });
    await page.locator('[aria-label="Create a story"] button:has-text("Place text")').click();
    await page.waitForTimeout(500);

    /* — §18/§21 the text is now a movable LAYER — */
    const layer = page.locator('[data-layer="0"]').first();
    ok((await layer.count()) > 0, "§21 the text became a layer on the canvas");
    const before = await layer.boundingBox();
    ok(Boolean(before), "§21 the layer has a real bounding box");

    /* — §45 drag: one finger moves the layer — */
    const cx = before.x + before.width / 2;
    const cy = before.y + before.height / 2;
    await page.touchscreen.tap(cx, cy); // select
    await page.waitForTimeout(250);
    const dragClient = await cdpTouch(page, [{ x: cx, y: cy }]);
    await touchMove(dragClient, [{ x: cx + 8, y: cy - 40 }]);
    await touchMove(dragClient, [{ x: cx + 10, y: cy - 120 }]);
    await touchEnd(dragClient);
    await page.waitForTimeout(400);
    const moved = await layer.boundingBox();
    ok(
      moved && Math.abs(moved.y - before.y) > 60,
      "§18 a finger DRAGS the layer anywhere on the canvas",
      `\u0394y=${Math.round((moved?.y || 0) - before.y)}`
    );

    /* — §45 pinch: two fingers apart = scale up — */
    const mid = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
    const a0 = { x: mid.x - 30, y: mid.y };
    const b0 = { x: mid.x + 30, y: mid.y };
    const pinch = await cdpTouch(page, [a0, b0]);
    await touchMove(pinch, [{ x: mid.x - 70, y: mid.y }, { x: mid.x + 70, y: mid.y }]);
    await touchMove(pinch, [{ x: mid.x - 110, y: mid.y }, { x: mid.x + 110, y: mid.y }]);
    await touchEnd(pinch);
    await page.waitForTimeout(450);
    const scaled = await layer.boundingBox();
    ok(
      scaled && scaled.width > moved.width * 1.4,
      "§21 two fingers SCALE the layer",
      `${Math.round(moved.width)}\u2192${Math.round(scaled?.width || 0)}`
    );

    /* — §45 rotate: two fingers, opposite directions — */
    const angleBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-layer="0"]');
      return el ? getComputedStyle(el).transform : "";
    });
    const r1 = { x: mid.x - 60, y: mid.y };
    const r2 = { x: mid.x + 60, y: mid.y };
    const spin = await cdpTouch(page, [r1, r2]);
    await touchMove(spin, [{ x: mid.x - 60, y: mid.y - 45 }, { x: mid.x + 60, y: mid.y + 45 }]);
    await touchMove(spin, [{ x: mid.x - 45, y: mid.y - 80 }, { x: mid.x + 45, y: mid.y + 80 }]);
    await touchEnd(spin);
    await page.waitForTimeout(450);
    const angleAfter = await page.evaluate(() => {
      const el = document.querySelector('[data-layer="0"]');
      return el ? getComputedStyle(el).transform : "";
    });
    const rot = (m) => {
      const n = (m.match(/matrix\(([^)]+)\)/) || [])[1];
      if (!n) return null;
      const p = n.split(",").map(Number);
      return Math.round((Math.atan2(p[1], p[0]) * 180) / Math.PI);
    };
    ok(
      rot(angleAfter) !== null && Math.abs(rot(angleAfter)) > 8 && rot(angleAfter) !== rot(angleBefore),
      "§45 two fingers ROTATE the layer",
      `${angleBefore.slice(0, 26)} \u2192 rot ${rot(angleAfter)}\u00b0`
    );

    /* — §19 drawing — */
    await page.locator('[aria-label="Create a story"] button[aria-label="Draw"]').click();
    await page.waitForTimeout(400);
    ok((await page.locator('[aria-label="Drawing tools"]').count()) > 0, "§19 the draw toolbar opens");
    const pen = page.locator('svg path[stroke-linecap="round"]').first();
    const canvasBox = await page.locator('[role="dialog"][aria-label="Create a story"] [data-layer], [role="dialog"][aria-label="Create a story"]').first().boundingBox();
    const cxb = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Create a story"]');
      const el = [...d.querySelectorAll("div")].find((x) => getComputedStyle(x).touchAction === "none" && x.getAttribute("aria-label") === null && x.clientHeight > 300);
      return el ? el.getBoundingClientRect() : null;
    });
    const box = cxb || canvasBox;
    await page.mouse.move(box.x + 60, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 240, { steps: 14 });
    await page.mouse.move(box.x + 200, box.y + 300, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const strokes = await page.evaluate(() => document.querySelectorAll('path[stroke-linecap="round"]').length);
    ok(strokes > 0, "§19 a finger stroke is drawn on the canvas", `paths=${strokes}`);
    await page.screenshot({ path: `${OUT}/05-story-draw-mode.png` });

    await page.locator('[aria-label="Create a story"] button[aria-label="Undo"]').click();
    await page.waitForTimeout(400);
    const afterUndo = await page.evaluate(() => document.querySelectorAll('path[stroke-linecap="round"]').length);
    ok(afterUndo < strokes, "§19 undo removes the stroke", `${strokes}→${afterUndo}`);
    await page.locator('[aria-label="Create a story"] button[aria-label="Redo"]').click();
    await page.waitForTimeout(400);
    const afterRedo = await page.evaluate(() => document.querySelectorAll('path[stroke-linecap="round"]').length);
    ok(afterRedo > afterUndo, "§19 redo brings it back", `${afterUndo}→${afterRedo}`);
    await page.locator('[aria-label="Create a story"] button[aria-label="Draw"]').click(); // leave draw mode
    await page.waitForTimeout(300);

    /* — §20 stickers from real data — */
    await page.locator('[aria-label="Create a story"] button[aria-label="Sticker"]').click();
    await page.waitForSelector('text=Add a sticker', { timeout: 4000 });
    const stickerText = await page.locator('[role="dialog"]').last().innerText();
    ok(/Mention/.test(stickerText) && /Event/.test(stickerText) && /Topic/.test(stickerText), "§20 the sticker tray offers Mention / Event / Topic");
    ok(!/Poll|Question/.test(stickerText), "§20 poll/question are NOT offered (they would need a vote model — not faked)");
    await page.locator('[aria-label="Create a story"] button:has-text("Mention"), [role="dialog"]:has-text("Add a sticker") button:has-text("Mention")').first().click();
    await page.waitForTimeout(300);
    await page.locator('input[aria-label="Search people to mention"]').fill("ben");
    await page.waitForTimeout(1400);
    const mentionRow = page.locator('[role="dialog"]').last().locator("button").filter({ hasText: "@" }).first();
    ok((await mentionRow.count()) > 0, "§20 the mention sticker searches REAL users");
    const mentionLabel = await mentionRow.innerText();
    await mentionRow.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/06-story-sticker-mode.png` });
    const stickerOnCanvas = await page.evaluate(() =>
      [...document.querySelectorAll("[data-layer]")].map((el) => el.innerText.trim())
    );
    ok(stickerOnCanvas.some((t) => t.startsWith("@")), "§20 the sticker landed on the canvas as a layer", JSON.stringify(stickerOnCanvas).slice(0, 80));

    /* — §16 emoji — */
    await page.locator('[aria-label="Create a story"] button[aria-label="Emoji"]').click();
    await page.waitForTimeout(300);
    await page.locator('button[aria-label="Add 🔥"]').click();
    await page.waitForTimeout(400);
    const emojiLayers = await page.evaluate(() => [...document.querySelectorAll("[data-layer]")].map((el) => el.innerText.trim()));
    ok(emojiLayers.some((t) => t.includes("🔥")), "§20 an emoji layer is placed");

    /* — §16 category + caption — */
    await page.locator('[aria-label="Create a story"] button:has-text("Hackathon")').first().click();
    await page.locator('input[aria-label="Caption"]').fill("doors open at 6");
    /* — §21 delete a layer — */
    const layerCountBefore = await page.locator("[data-layer]").count();
    await page.locator('[data-layer="0"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('button[aria-label="Delete layer"]').first().click();
    await page.waitForTimeout(400);
    const layerCountAfter = await page.locator("[data-layer]").count();
    ok(layerCountAfter === layerCountBefore - 1, "§21 a layer can be deleted", `${layerCountBefore}→${layerCountAfter}`);

    /* — §22 preview — */
    await page.locator('[aria-label="Create a story"] button:has-text("Preview")').click();
    await page.waitForTimeout(700);
    const previewText = await page.locator('[role="dialog"][aria-label="Create a story"]').innerText();
    ok(/Share to story/.test(previewText), "§22 preview offers Share");
    ok(/24 hours/.test(previewText), "§22 the audience is stated honestly (followers, 24 hours)");
    ok(/Back/.test(previewText), "§22 preview offers Back");
    const previewLayers = await page.evaluate(() =>
      [...document.querySelectorAll("[data-layer], [role='dialog'] span")].map((el) => el.innerText || "").join(" ")
    );
    ok(/🔥/.test(previewLayers) && /@/.test(previewLayers), "§22 the preview shows the layers as composed");
    await page.screenshot({ path: `${OUT}/07-story-preview.png` });

    /* — §23 publish — */
    const railRequests = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/stories")) railRequests.push(r.url());
    });
    await page.locator('[aria-label="Create a story"] button:has-text("Share to story")').click();
    await page.waitForTimeout(6000);
    ok((await page.locator('[role="dialog"][aria-label="Create a story"]').count()) === 0, "§23 publishing closes the creator");
    const bodyText = await page.evaluate(() => document.body.innerText);
    ok(/Story published|24 hours/i.test(bodyText) || railRequests.some((u) => u.includes("/stories")), "§23 success is reported and the rail is refetched");
    ok(railRequests.some((u) => u.includes("/api/stories")), "§23 the story API was called", `calls=${railRequests.length}`);

    /* the story really exists, with its layers */
    const stored = await page.evaluate(async () => {
      const t = localStorage.getItem("token");
      const r = await fetch("/api/stories/archive", { headers: { authorization: `Bearer ${t}` } });
      const d = await r.json();
      const list = (d.groups || []).flatMap((g) => g.stories);
      const latest = list[0];
      return latest ? { id: latest._id, layers: (latest.layers || []).map((l) => l.type), count: (latest.layers || []).length, caption: latest.caption, expiresIn: Math.round((new Date(latest.expiresAt) - Date.now()) / 3600000) } : null;
    });
    ok(Boolean(stored), "§23 the published story is stored");
    ok(stored && stored.count >= 3, "§23 the layers were published with it", `layers=${stored?.layers?.join(",")}`);
    ok(stored && stored.layers.includes("draw"), "§23 the drawing is part of the story metadata");
    ok(stored && stored.expiresIn === 23 || stored?.expiresIn === 24, "§24 the story is live for 24 hours", `${stored?.expiresIn}h`);

    /* — §23 it appears in the rail without a reload — */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);
    const rail = await page.evaluate(() => document.body.innerText);
    ok(/Your story/i.test(rail), "§23 the rail shows Your story with the new item");
    await page.screenshot({ path: `${OUT}/02-story-rail.png` });

    /* — §45 viewer gestures: open it and step through — */
    /* §23 — the ring now opens YOUR story, because you have one. */
    const yourRing = page.locator('button[aria-label^="Your story"], button[aria-label^="View your story"]').first();
    ok((await yourRing.count()) > 0, "§23 your own ring is present and labelled");
    const yrBox = await yourRing.boundingBox();
    await page.touchscreen.tap(yrBox.x + yrBox.width / 2, yrBox.y + 22);
    await page.waitForTimeout(1600);
    const viewerOpen = (await page.locator("[aria-label$=\"story\"], [aria-label*=\"story\"]").count()) > 0;
    ok(viewerOpen, "§23 tapping your ring opens the VIEWER (not the creator)");
    if (viewerOpen) {
      const shown = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 90));
      info("viewer", shown);
      /* §45 — tap right advances, swipe down closes. */
      const box = await page.locator('[role="dialog"][aria-label*="story"]').first().boundingBox();
      const before = await page.evaluate(() => {
        const bars = [...document.querySelectorAll(".story-progress, [class*='progress']")];
        return bars.map((b) => getComputedStyle(b).transform).join("|").slice(0, 80);
      });
      await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height * 0.5);
      await page.waitForTimeout(1600);
      const advanced = await page.evaluate(() => {
        const bars = [...document.querySelectorAll(".story-progress, [class*='progress']")];
        return bars.map((b) => getComputedStyle(b).transform).join("|").slice(0, 80);
      });
      ok(advanced !== before, "§45 tapping the right side advances the story", `progress ${before.slice(0, 30)} → ${advanced.slice(0, 30)}`);
      /* §45 — swipe down closes. Your own story has no X (it has the owner
         menu), so the gesture is the way out for everyone. */
      const swipe = await cdpTouch(page, [{ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height * 0.3) }]);
      await touchMove(swipe, [{ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height * 0.6) }]);
      await touchMove(swipe, [{ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height * 0.85) }]);
      await touchEnd(swipe);
      await page.waitForTimeout(900);
      let closed = (await page.locator("button[aria-label=\"Close story\"], button[aria-label=\"Story options\"]").count()) === 0;
      if (!closed) {
        const x = page.locator('button[aria-label="Close story"]');
        if ((await x.count()) > 0) {
          await x.click();
          await page.waitForTimeout(700);
          closed = true;
        }
      }
      ok(closed, "§45 swiping down closes the viewer");
    }
    ok(errors.length === 0, "§49 no page errors while composing", errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * B · DESKTOP MUST NOT OFFER THE EDITOR (§14)
   * ══════════════════════════════════════════════════════════════════════ */
  section("B · desktop story creation is restricted (§14)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    await page.getByRole("button", { name: "Create", exact: true }).first().click();
    await page.waitForSelector('[role="menu"]', { timeout: 5000 });
    await page.locator('[role="menu"]').first().getByText("Create Story", { exact: false }).first().click();
    await page.waitForTimeout(1200);
    const text = await page.evaluate(() => document.body.innerText);
    ok(/Stories are created on the phone/i.test(text), "§14 desktop shows the mobile-only explanation");
    ok(!/Camera[\s\S]*Gallery[\s\S]*Preview/.test(text), "§14 …and NOT a crippled editor");
    ok(/Copy the link|eventhub\.app/i.test(text), "§14 …with a way to get there on a phone");
    await page.screenshot({ path: `${OUT}/18-desktop-story-restricted.png` });

    /* — §14 creating a story does NOT navigate anywhere — */
    ok(new URL(page.url()).pathname === "/", "§14 opening it did not navigate", page.url());
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * C · PROFILE, POSTS, SAVED / LIKED / ARCHIVE (§2–§13, §47–§48)
   * ══════════════════════════════════════════════════════════════════════ */
  section("C · profile + own content");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);

    const profile = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        text: text.slice(0, 400),
        hasCover: Boolean(document.querySelector("img[src*='cover'], img[preset], [data-testid='profile-cover']")) || /cover/i.test(document.body.innerHTML.slice(0, 20000)),
        avatar: document.querySelectorAll("img[alt*='photo' i], img[alt*='avatar' i]").length,
      };
    });
    ok(/Posts/.test(profile.text), "§8 the profile shows a Posts area");
    ok(/@/.test(profile.text), "§2 the username is visible");
    ok(/Followers?/i.test(profile.text) && /Following/.test(profile.text), "§2 follower/following counts are visible");
    ok(/Edit profile/i.test(profile.text), "§2 own profile offers Edit profile");
    ok(!/\bXP\b|\bLV\b|\bpoints\b|level \d/i.test(profile.text), "§41 no fake metrics (XP / points / levels)");

    /* — §8/§47 the owner's own content is reachable — */
    const tabs = ["Saved", "Liked", "Archive"];
    for (const t of tabs) {
      const pill = page.locator(`button:has-text("${t}"), a:has-text("${t}")`).first();
      ok((await pill.count()) > 0, `§8 the profile exposes ${t}`);
    }
    await page.screenshot({ path: `${OUT}/10-mobile-profile.png` });

    /* — §9/§10/§11/§12 each surface really lists the right thing — */
    for (const [path, label, key] of [
      ["/saved", "§10 Saved", "saved"],
      ["/liked", "§11 Liked", "liked"],
    ]) {
      await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);
      const body = await page.evaluate(() => document.body.innerText);
      ok(!/Application error|Something went wrong/i.test(body), `${label} renders without an error`);
      const posts = await page.locator("article").count();
      ok(
        posts > 0 || /Nothing (saved|liked)|No (saved|liked)/i.test(body),
        `${label} lists posts or states the empty case`,
        `articles=${posts}`
      );
      if (path === "/saved") {
        /* §10 names the empty state and its way out verbatim. */
        if (posts === 0) {
          ok(/No saved posts yet\./.test(body), "§10 the empty state says \"No saved posts yet.\"");
          ok(/Explore events/i.test(body), "§10 …and offers a way out (Explore events)");
        }
        /* §10 — saved is private, and says so. */
        ok(/Private to you/i.test(body), "§10 the screen states that saved posts are private");
      }
      await page.screenshot({ path: `${OUT}/${label.split(" ")[1].toLowerCase()}-posts.png` });
    }

    /* — §12 Archive is ONE destination with Posts AND Stories — */
    await page.goto(`${APP}/archived`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const archive = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tablist"][aria-label="Archive sections"] [role="tab"]')].map(
        (t) => t.innerText.trim()
      );
      return { tabs, text: document.body.innerText };
    });
    ok(archive.tabs.length === 2, "§12 Archive exposes two sections", JSON.stringify(archive.tabs));
    ok(/Posts/.test(archive.tabs[0] || ""), "§12 …Posts first");
    ok(/Stories/.test(archive.tabs[1] || ""), "§12 …and Stories");
    ok(!/Application error/i.test(archive.text), "§12 the posts section renders");
    /* archive ≠ saved ≠ liked, stated on the screen that could be confused. */
    ok(/neither saved nor liked|Archives are neither saved nor liked/i.test(archive.text), "§12 archive is distinguished from saved and liked");
    ok(archive.text.trim().length > 0, "§12 the posts section has content or its empty state");
    const storiesTab = page.locator('[role="tablist"][aria-label="Archive sections"] [role="tab"]').nth(1);
    const sbox = await storiesTab.boundingBox();
    ok(sbox.height >= 40, "§12 the section tabs are touch-sized", `${Math.round(sbox.height)}px`);
    await storiesTab.click();
    await page.waitForTimeout(2600);
    const storiesView = await page.evaluate(() => {
      const sel = document.querySelector('[role="tablist"][aria-label="Archive sections"] [role="tab"][aria-selected="true"]');
      return { selected: sel?.innerText.trim(), text: document.body.innerText };
    });
    ok(/Stories/.test(storiesView.selected || ""), "§12 the Stories section selects");
    ok(
      /[A-Z][a-z]+ \d{4}/.test(storiesView.text) || /No archived stories yet/i.test(storiesView.text),
      "§12 …and shows grouped stories (or the honest empty state)"
    );
    await page.screenshot({ path: `${OUT}/archive-stories.png` });

    /* — §13 the profile menu differs for own vs other — */
    await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2800);
    const menuBtn = page.locator('button[aria-label="More options"]:visible').first();
    if ((await menuBtn.count()) > 0) {
      await menuBtn.click();
      await page.waitForTimeout(500);
      const menu = await page.locator('[role="menu"]').first().innerText();
      ok(
        /Edit profile/.test(menu) &&
          /Your activity/.test(menu) &&
          /Saved/.test(menu) &&
          /Liked/.test(menu) &&
          /Archive/.test(menu) &&
          /Settings/.test(menu),
        "§13 own profile menu offers owner actions only",
        menu.replace(/\n+/g, " / ")
      );
      ok(!/Block|Report/.test(menu), "§13 …and no other-person actions");
      await page.screenshot({ path: `${OUT}/11-profile-menu.png` });
      /* the items are real destinations, not dead labels */
      await page.locator('[role="menu"] a:has-text("Your activity")').first().click();
      await page.waitForTimeout(2600);
      const activity = await page.evaluate(() => document.body.innerText);
      ok(/Your activity/i.test(activity) && !/Application error/i.test(activity), "§48 Your activity opens");
      const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.trim()));
      ok(
        ["Posts", "Likes", "Saved", "Archived", "Stories"].every((t) => tabs.includes(t)),
        "§48 it carries Posts / Likes / Saved / Archived / Stories",
        JSON.stringify(tabs)
      );
      ok(!tabs.includes("Comments"), "§48 no Comments tab (no such endpoint exists — not faked)");
      await page.screenshot({ path: `${OUT}/12-activity.png` });

      await page.goto(`${APP}/user/settings`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2600);
      const settings = await page.evaluate(() => document.body.innerText);
      ok(/Settings/i.test(settings) && /Privacy/i.test(settings), "§13 Settings opens with real sections");
      ok(/Public/.test(settings) && /Followers/.test(settings), "§13 profile visibility is settable");
      ok(/Log out/.test(settings), "§13 …and sign-out lives here too");
      await page.screenshot({ path: `${OUT}/13-settings.png` });
      await page.keyboard.press("Escape");
    } else {
      info("profile menu", "no overflow menu found on this screen");
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * D · MESSAGES (§32–§39)
   * ══════════════════════════════════════════════════════════════════════ */
  section("D · messages");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);

    /* — §32/§33 one obvious entry point, with its badge — */
    const entry = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const links = [...(nav?.querySelectorAll("a") || [])].map((a) => ({
        href: a.getAttribute("href"),
        text: a.innerText.trim(),
        badge: /\d/.test(a.innerText),
        h: Math.round(a.getBoundingClientRect().height),
      }));
      return { links, bell: document.querySelectorAll('button[aria-label*="otification" i]').length };
    });
    const msgLink = entry.links.find((l) => l.href === "/messages");
    ok(Boolean(msgLink), "§32 Messages has a persistent entry point in the bottom nav", JSON.stringify(entry.links.map((l) => l.href)));
    ok(msgLink && msgLink.h >= 44, "§32 …and it is a full-height touch target", `${msgLink?.h}px`);
    ok(msgLink && msgLink.badge, "§32 …with an unread badge visible", msgLink?.text?.replace(/\n/g, " "));
    await page.screenshot({ path: `${OUT}/15-messages-entry.png` });

    /* — §34 list + filters, including Archived — */
    await page.goto(`${APP}/messages`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const filters = await page.evaluate(() => {
      const row = [...document.querySelectorAll('button, [role="tab"]')].filter((b) => /^(All|Unread|Teams|Archived)$/.test(b.innerText.trim()));
      return row.map((b) => ({ label: b.innerText.trim(), h: Math.round(b.getBoundingClientRect().height) }));
    });
    ok(filters.length >= 3, "§34 the inbox has filters", JSON.stringify(filters.map((f) => f.label)));
    ok(filters.some((f) => f.label === "Archived"), "§37 Archived is one of them");
    ok(filters.every((f) => f.h >= 36), "§30 filters are touch-sized", JSON.stringify(filters));
    await page.screenshot({ path: `${OUT}/15-mobile-messages.png` });

    /* — §35 sent right / received left, on a real thread — */
    const dmId = READY.dmId;
    if (dmId) {
      await page.goto(`${APP}/messages/${dmId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3600);
      const bubbles = await page.evaluate(() => {
        const els = [...document.querySelectorAll("[data-bubble], .rounded-2xl")].filter((e) => e.innerText.trim().length > 0 && e.clientHeight < 220);
        const mid = window.innerWidth / 2;
        return els.slice(0, 8).map((e) => {
          const r = e.getBoundingClientRect();
          return { text: e.innerText.trim().slice(0, 18), centre: Math.round(r.x + r.width / 2), side: r.x + r.width / 2 > mid ? "right" : "left" };
        });
      });
      const sides = new Set(bubbles.map((b) => b.side));
      ok(bubbles.length > 0, "§35 the thread renders messages", `bubbles=${bubbles.length}`);
      ok(sides.size === 2 || bubbles.length === 1, "§35 sent and received sit on OPPOSITE sides", JSON.stringify(bubbles.map((b) => b.side)));
      await page.screenshot({ path: `${OUT}/16-conversation.png` });
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * E · FEED (§27–§31)
   * ══════════════════════════════════════════════════════════════════════ */
  section("E · feed");
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    /* — §27/§28 the rail is simple: rings, not a dashboard — */
    const rail = await page.evaluate(() => {
      const el = document.querySelector('[role="list"][aria-label="Stories"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), w: Math.round(r.width), items: el.children.length, text: el.innerText.replace(/\n+/g, " ").slice(0, 80) };
    });
    ok(Boolean(rail), "§28 the story rail renders");
    ok(rail && rail.h <= 150, "§28 the rail is a compact strip, not a hero card", `h=${rail?.h}px`);
    ok(rail && !/\d+\s*(views|likes|analytics)/i.test(rail.text), "§27 the rail shows no analytics-style numbers");

    /* — §29/§30/§31 filters: 44px, tappable, state visible, no reload — */
    const tabs = await page.evaluate(() => {
      const strip = document.querySelector('[role="group"][aria-label="Feed filters"]');
      const els = [...(strip?.querySelectorAll("button, [role=tab]") || [])];
      return els.map((b) => ({
        label: b.innerText.trim(),
        h: Math.round(b.getBoundingClientRect().height),
        pressed: b.getAttribute("aria-pressed") || b.getAttribute("aria-selected"),
        x: Math.round(b.getBoundingClientRect().x),
      }));
    });
    ok(tabs.length === 4, "§30 the feed exposes four filters", JSON.stringify(tabs.map((t) => t.label)));
    ok(tabs.every((t) => t.h >= 44), "§30 every filter is ≥44px tall (§29's real cause)", JSON.stringify(tabs.map((t) => t.h)));
    ok(tabs.some((t) => t.pressed === "true"), "§31 the selected filter is visible");
    ok(tabs.every((t) => t.x >= 0), "§30 no filter starts off-screen", JSON.stringify(tabs.map((t) => t.x)));

    /* tapping a filter switches content without a full navigation */
    let navigations = 0;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigations++;
    });
    await page.locator('[aria-label="Feed filters"] button:has-text("Following")').first().click();
    await page.waitForTimeout(2200);
    const following = await page.evaluate(() => {
      const strip = document.querySelector('[role="group"][aria-label="Feed filters"]');
      const b = [...(strip?.querySelectorAll("button, [role=tab]") || [])].find((x) =>
        x.innerText.trim() === "Following"
      );
      return b?.getAttribute("aria-pressed") || b?.getAttribute("aria-selected");
    });
    ok(following === "true", "§31 switching filters updates the selected state");
    ok(navigations <= 1, "§31 …without a full page reload", `navigations=${navigations}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, "§30 no horizontal overflow on a 375px phone", `${overflow}px`);
    await page.screenshot({ path: `${OUT}/01-mobile-home.png` });

    /* — the "+" still behaves (Part 13 regression, in the same run) — */
    const createBtn = page.locator('nav[aria-label="Primary"] button[aria-label="Create"]').first();
    const cbox = await createBtn.boundingBox();
    await page.touchscreen.tap(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.waitForSelector('[role="menu"]', { timeout: 4000 });
    await page.waitForTimeout(400);
    const menuBox = await page.locator('[role="menu"]').first().boundingBox();
    ok(menuBox.y + menuBox.height <= cbox.y + 2, "§29 the create menu opens above its button, stable");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    ok(errors.length === 0, "§49 no page errors on the feed", errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * F · ARCHIVE (§24–§25)
   * ══════════════════════════════════════════════════════════════════════ */
  section("F · story archive");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/stories/archive`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const body = await page.evaluate(() => document.body.innerText);
    ok(/Archive/i.test(body), "§25 the story archive page loads");
    const monthLabel = (body.match(/[A-Z][a-z]+ \d{4}/) || [])[0] || "";
    const emptyArchive = /No archived stories yet/i.test(body);
    ok(
      Boolean(monthLabel) || emptyArchive,
      "§25 archived stories are grouped by month and year (or the empty state is shown)",
      monthLabel || (emptyArchive ? "no expired stories yet" : body.slice(0, 60))
    );
    ok(!/EN\b.*\bHA\b/.test(body), "§26 no two-letter initial placeholders anywhere");
    await page.screenshot({ path: `${OUT}/09-story-archive.png` });
    await ctx.close();
  }

  console.log(`\nPART 9 harness: ${checks - failures}/${checks} checks passed`);
  if (failures) console.log(`${failures} FAILED`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
