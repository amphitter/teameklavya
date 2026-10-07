#!/usr/bin/env node
/**
 * Phase 4 across the widths the brief names: 320 / 360 / 375 / 390 / 412 / 430.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node phase4-widths.js
 *
 * Phase 4 gives the feed a second shape: interleaved discovery cards carrying an
 * event row, a people row with a follow pill, and a community row. A card is a
 * horizontal composition (avatar + two text lines + trailing control) inside a
 * page that already has a bottom nav, so it is exactly the kind of thing that
 * survives at 390 and breaks at 320. This pass checks, per width:
 *
 *   • zero horizontal overflow of the page AND of every discovery card
 *   • the people row keeps its pill inside the viewport (a clipped follow pill
 *     is a dead control — the same failure the Phase 3 tab strip had)
 *   • rows are counted by distinct child `top` offsets, so a row that was meant
 *     to wrap into two lines is measured as two, not guessed from height
 *   • the post media surface that carries double-tap-to-like is big enough to
 *     hit and fully on screen (a 1px sliver is not a gesture target)
 *   • the avatar preview fits the viewport and its image is a real decoded one
 *   • the story viewer does not scroll sideways and its media stays inside
 *   • the profile's Follow/Edit action row stays on screen
 *   • no uncaught page errors at any width
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "ana1791402264568@qa.com", password: "Test1234!" };
const OUT = "/home/user/qa/profile-audit";

const WIDTHS = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
];

let failures = 0;
let checks = 0;
const ok = (cond, label, detail = "") => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  ❌ [${label}]${detail ? ` — ${detail}` : ""}`);
  }
};
const info = (label, detail) => console.log(`     · ${label}: ${detail}`);

const signIn = async (page) => {
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
  }, CREDS);
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));

    await signIn(page);
    const tag = `w${w}`;

    /* ── the feed, with its discovery cards ─────────────────────────────── */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);

    const geom = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    ok(
      geom.scrollW <= geom.clientW + 1 && geom.bodyScrollW <= geom.clientW + 1,
      `${tag} · the feed does not scroll sideways`,
      `doc ${geom.scrollW}/${geom.clientW} · body ${geom.bodyScrollW}`
    );

    const cards = await page.evaluate(() => {
      const vw = window.innerWidth;
      return [...document.querySelectorAll("[data-discovery]")].map((el) => {
        const r = el.getBoundingClientRect();
        const rows = new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top)));
        /* Anything inside the card that a finger is meant to hit. */
        const controls = [...el.querySelectorAll("a,button")].map((c) => {
          const cr = c.getBoundingClientRect();
          return {
            label: (c.getAttribute("aria-label") || c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 24),
            w: Math.round(cr.width),
            h: Math.round(cr.height),
            left: Math.round(cr.left),
            right: Math.round(cr.right),
          };
        });
        return {
          kind: el.getAttribute("data-discovery"),
          left: Math.round(r.left),
          right: Math.round(r.right),
          viewport: vw,
          rows: rows.size,
          controls,
        };
      });
    });
    info(`${tag} · discovery cards`, `${cards.length}${cards.length ? ` (${cards.map((c) => c.kind).join(", ")})` : ""}`);
    for (const c of cards) {
      ok(
        c.left >= -1 && c.right <= c.viewport + 1,
        `${tag} · the ${c.kind} card stays inside the viewport`,
        `x ${c.left}→${c.right} of ${c.viewport}`
      );
      ok(c.rows >= 1, `${tag} · the ${c.kind} card renders rows`, `${c.rows}`);
      const clipped = c.controls.filter((k) => k.right > c.viewport + 1 || k.left < -1);
      ok(
        clipped.length === 0,
        `${tag} · every control in the ${c.kind} card is on screen`,
        JSON.stringify(clipped)
      );
      /* The follow pill is the one control whose whole job is a round target. */
      /* Touch target. Apple's ideal is 44px; these inline pills ship at 36px
         (they measured 77x25 before this phase — docs/PHASE4_FEED_AUDIT.md). The
         failure this guards against is a pill squeezed by the row it lives in at
         320px, which is exactly what the first run of this file found. */
      for (const k of c.controls.filter((x) => /follow/i.test(x.label))) {
        ok(
          k.w >= 64 && k.h >= 36,
          `${tag} · the follow pill is a real touch target in the ${c.kind} card`,
          `${k.w}×${k.h} "${k.label}"`
        );
      }
    }

    /* ── the double-tap surface is a real target at every width ─────────── */
    const media = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="post-media"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), viewport: window.innerWidth };
    });
    if (media) {
      ok(
        media.w >= 120 && media.h >= 80,
        `${tag} · the double-tap media surface is large enough to hit`,
        `${media.w}×${media.h}`
      );
      ok(
        media.left >= -1 && media.right <= media.viewport + 1,
        `${tag} · the media surface stays inside the viewport`,
        `x ${media.left}→${media.right} of ${media.viewport}`
      );
    } else {
      info(`${tag} · media surface`, "none rendered");
    }

    /* ── profile: the action row and the avatar preview ─────────────────── */
    await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    const actions = await page.evaluate(() => {
      const vw = window.innerWidth;
      const btns = [...document.querySelectorAll("button")].filter((b) =>
        /^(edit profile|\+? ?follow|following|requested|sign in to follow)$/i.test((b.innerText || "").trim())
      );
      return {
        vw,
        row: btns.map((b) => {
          const r = b.getBoundingClientRect();
          return { text: b.innerText.trim().slice(0, 16), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height) };
        }),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok(
      actions.overflow <= 1,
      `${tag} · the profile does not scroll sideways`,
      `overflow ${actions.overflow}px`
    );
    for (const b of actions.row) {
      ok(
        b.left >= -1 && b.right <= actions.vw + 1,
        `${tag} · "${b.text}" stays inside the viewport`,
        `x ${b.left}→${b.right} of ${actions.vw}`
      );
      ok(b.h >= 28, `${tag} · "${b.text}" is a tappable height`, `${b.h}px`);
    }

    const avatarBtn = page
      .locator('button[aria-label="View profile photo"], button[aria-label="Profile photo, not added yet"]')
      .first();
    if ((await avatarBtn.count()) > 0) {
      const abox = await avatarBtn.boundingBox();
      ok(
        abox && Math.abs(abox.width - abox.height) <= 2,
        `${tag} · the avatar affordance is square`,
        abox ? `${Math.round(abox.width)}×${Math.round(abox.height)}` : "no box"
      );
      await avatarBtn.scrollIntoViewIfNeeded();
      await avatarBtn.click();
      await page.waitForTimeout(700);
      const preview = await page.evaluate(() => {
        const img = document.querySelector('[data-testid="avatar-preview-image"]');
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return null;
        const dr = dlg.getBoundingClientRect();
        return {
          hasImage: Boolean(img),
          natural: img ? img.naturalWidth : null,
          dlgW: Math.round(dr.width),
          dlgH: Math.round(dr.height),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      /* The preview has two honest shapes. A member WITH a photo must show the
         decoded image; a member without one gets the initials fallback. What is
         never acceptable is a dialog that does not open, a broken image, or a
         preview wider than the phone. */
      const hasPhoto = await page.evaluate(async () => {
        const r = await (await fetch("/api/auth/me", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
        return Boolean(r?.user?.profile?.avatar);
      });
      ok(Boolean(preview), `${tag} · the avatar preview opens${hasPhoto ? "" : " (initials fallback)"}`);
      if (preview) {
        ok(
          hasPhoto ? preview.hasImage && preview.natural > 0 : !preview.hasImage,
          hasPhoto
            ? `${tag} · the preview shows the decoded photo`
            : `${tag} · with no photo it shows initials rather than a broken image`,
          `hasImage=${preview.hasImage} natural=${preview.natural}`
        );
        ok(
          preview.dlgW <= w + 1 && preview.dlgH <= h + 1,
          `${tag} · the preview dialog fits the viewport`,
          `${preview.dlgW}×${preview.dlgH} in ${preview.viewport}`
        );
        ok(preview.overflow <= 1, `${tag} · the preview does not create sideways scroll`, `${preview.overflow}px`);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else {
      info(`${tag} · avatar affordance`, "not rendered");
    }

    /* ── the story viewer, if this account has a story to open ──────────── */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => {
        const l = (b.getAttribute("aria-label") || "").trim();
        return /'s story$/.test(l) && !/^add/i.test(l);
      });
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (opened) {
      await page.waitForTimeout(1100);
      const viewer = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"], .fixed.inset-0.z-\\[90\\]');
        if (!dlg) return null;
        const media = dlg.querySelector("img.object-contain, video");
        const r = dlg.getBoundingClientRect();
        const mr = media?.getBoundingClientRect();
        return {
          dlgW: Math.round(r.width),
          dlgH: Math.round(r.height),
          mediaInside: mr ? mr.left >= -1 && mr.right <= window.innerWidth + 1 : null,
          mediaNat: media ? media.naturalWidth : null,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      ok(Boolean(viewer), `${tag} · the story viewer opens from the rail`);
      if (viewer) {
        ok(
          viewer.mediaInside !== false,
          `${tag} · the story media stays inside the viewport`,
          JSON.stringify(viewer)
        );
        ok(viewer.overflow <= 1, `${tag} · the story viewer adds no sideways scroll`, `${viewer.overflow}px`);
      }
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        const close = document.querySelector('[role="dialog"] button[aria-label*="lose" i]');
        close?.click();
      });
      await page.waitForTimeout(500);
    } else {
      info(`${tag} · story viewer`, "no story ring to open this render");
    }

    ok(errors.length === 0, `${tag} · no uncaught page errors`, errors.join(" | "));

    await page.screenshot({ path: `${OUT}/phase4-widths-${w}.png`, fullPage: false });
    await ctx.close();
  }

  await browser.close();
  console.log(failures === 0 ? `\n✅ PHASE 4 WIDTHS: ${checks} checks, 0 failures` : `\n❌ PHASE 4 WIDTHS: ${checks} checks, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
