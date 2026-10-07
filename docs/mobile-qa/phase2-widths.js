#!/usr/bin/env node
/**
 * Phase 2 across the widths the brief names: 320 / 360 / 375 / 390 / 412 / 430.
 *
 *   cd /var/tmp/pw && node phase2-widths.js
 *
 * The crop editor is the one screen in this product that has to work on the
 * smallest phone at all — a 320px viewport with a square canvas, a zoom
 * slider, a hint line and two buttons. Each width is checked for:
 *   • horizontal overflow of the page (0 px of sideways scroll)
 *   • the crop frame being SQUARE and fully inside the viewport
 *   • the confirm button and the zoom slider being hit-testable
 *     (elementFromPoint at their centre returns them — a layout that only
 *     looks right is not enough)
 *   • the edit sheet's own avatar preview being a square, not an oval
 */
const { chromium } = require("playwright");
const fs = require("fs");
const zlib = require("zlib");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "ana1791398088976@qa.com", password: "Test1234!" };
const USERNAME = process.env.QA_USERNAME || "ana_roy";

const WIDTHS = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
];

/* A tiny valid PNG to drive the file input with. */
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
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
function png(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3), 90);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
fs.mkdirSync("/var/tmp/pw/fixtures", { recursive: true });
const FIXTURE = "/var/tmp/pw/fixtures/widths-1000x1400.png";
fs.writeFileSync(FIXTURE, png(1000, 1400));

let failures = 0;
const line = (w, label, pass, detail) => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✅" : "❌"} ${String(w).padStart(3)}px  ${label}${detail ? ` — ${detail}` : ""}`);
};

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const [w, h] of WIDTHS) {
    console.log(`\n══ ${w}×${h} ══`);
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async (c) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(c),
      });
      const d = await r.json();
      localStorage.setItem("token", d.token);
      localStorage.setItem("user", JSON.stringify(d.user));
    }, CREDS);

    await page.goto(`${APP}/profile/${USERNAME}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const ovf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    line(w, "profile page: no horizontal overflow", ovf <= 0, `ovf=${ovf}`);

    const editBtn = page.locator("button", { hasText: "Edit profile" }).first();
    const reachable = await editBtn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit) && (el.contains(hit) || hit.contains(el));
    });
    line(w, "Edit profile is hit-testable", reachable);
    if (!reachable) {
      await ctx.close();
      continue;
    }
    await editBtn.click();
    const sheet = page.locator('[role="dialog"][aria-label="Edit profile"]');
    await sheet.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500);

    const sheetOvf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    line(w, "edit sheet: no horizontal overflow", sheetOvf <= 0, `ovf=${sheetOvf}`);

    const preview = await page.evaluate(() => {
      const sec = [...document.querySelectorAll('[role="dialog"] section')].find((s) =>
        /PROFILE PHOTO/i.test(s.innerText || "")
      );
      if (!sec) return null;
      /* The preview is a bordered circle: a photo when there is one, initials
         when there is not. Both have to be a circle — the squashed oval this
         checks for only showed up when a photo was present. */
      const circle = sec.querySelector("div.rounded-full");
      const inner = circle?.firstElementChild || null;
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          tag: el.tagName,
          visible: Boolean(hit) && (el.contains(hit) || hit.contains(el)),
        };
      };
      return { circle: box(circle), inner: box(inner) };
    });
    const sw = preview?.inner?.w ?? 0;
    line(
      w,
      "the sheet's avatar preview is a circle, not a squashed oval",
      Boolean(preview) &&
        preview.circle?.w === preview.circle?.h &&
        preview.inner?.w === preview.inner?.h &&
        preview.circle?.visible &&
        sw > 40,
      JSON.stringify(preview)
    );

    /* Now the crop editor on a 1000×1400 photo. */
    await sheet.locator('input[type="file"]:not([capture])').first().setInputFiles(FIXTURE);
    const editor = page.locator('[role="dialog"][aria-label="Profile photo"]');
    await editor.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(600);

    const frame = await editor
      .locator('[aria-label="Drag to reposition, pinch or use the slider to zoom"]')
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          vh: window.innerHeight,
          vw: window.innerWidth,
          touchAction: getComputedStyle(el).touchAction,
        };
      });
    line(
      w,
      "crop frame is square and inside the viewport",
      frame.w === frame.h && frame.bottom <= frame.vh && frame.w > 100 && frame.top >= 0,
      JSON.stringify(frame)
    );
    line(w, "frame keeps touch-action:none", frame.touchAction === "none", frame.touchAction);

    const confirmHit = await editor.locator("button", { hasText: "Use photo" }).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { reachable: Boolean(hit) && (el.contains(hit) || hit.contains(el)), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    line(w, "“Use photo” is hit-testable and on screen", confirmHit.reachable && confirmHit.bottom <= confirmHit.vh, JSON.stringify(confirmHit));

    const sliderHit = await editor.locator('input[aria-label="Zoom"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { reachable: Boolean(hit) && (el.contains(hit) || hit.contains(el)), width: Math.round(r.width) };
    });
    line(w, "the zoom slider is hit-testable", sliderHit.reachable && sliderHit.width > 120, JSON.stringify(sliderHit));

    const edOvf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    line(w, "crop editor: no horizontal overflow", edOvf <= 0, `ovf=${edOvf}`);

    await editor.locator("button", { hasText: "Cancel" }).first().click();
    await page.waitForTimeout(300);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "✅" : "❌"} PHASE 2 WIDTHS: ${failures} failure(s) across 6 widths`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
